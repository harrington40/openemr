import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  StockStatus,
  ExpirationStatus,
  TransactionType,
  DEFAULT_EXPIRATION_ALERT_DAYS,
  computeStockStatus,
  computeExpirationStatus,
  daysUntilExpiration,
  resolveTransactionDelta,
  applyStockChange,
  compareByDepletion,
} from './inventory-status.util';
import { BillingService } from '../billing/billing.service';

const ITEM_COLUMNS = `id, item_name, item_code, description, category, department,
  storage_location, current_quantity, minimum_quantity, unit, unit_cost, unit_price,
  supplier, lot_number, expiration_date, reorder_quantity, barcode, rfid_tag,
  is_active, created_at, updated_at`;

export interface InventoryUser {
  id?: number;
  displayName?: string;
}

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly billing: BillingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.seedDemoData();
    await this.seedVendors();
    await this.ensureInventoryManagerUser();
    await this.backfillBarcodes();
    await this.dedupeInventory();
  }

  // ── Schema ─────────────────────────────────────────────────────────────

  async ensureSchema(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_items (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           item_name VARCHAR(255) NOT NULL,
           item_code VARCHAR(100) DEFAULT NULL,
           description TEXT,
           category VARCHAR(50) NOT NULL DEFAULT 'Other',
           department VARCHAR(100) DEFAULT NULL,
           storage_location VARCHAR(100) DEFAULT NULL,
           current_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
           minimum_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
           unit VARCHAR(50) DEFAULT NULL,
           unit_cost DECIMAL(12,4) DEFAULT NULL,
           supplier VARCHAR(255) DEFAULT NULL,
           lot_number VARCHAR(100) DEFAULT NULL,
           expiration_date DATE DEFAULT NULL,
           is_active TINYINT(1) NOT NULL DEFAULT 1,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           UNIQUE KEY uq_inventory_item_code (item_code),
           KEY idx_inventory_category (category),
           KEY idx_inventory_department (department),
           KEY idx_inventory_expiration (expiration_date)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_transactions (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           inventory_item_id INT NOT NULL,
           transaction_type VARCHAR(20) NOT NULL,
           quantity DECIMAL(12,2) NOT NULL,
           source_location VARCHAR(100) DEFAULT NULL,
           destination_location VARCHAR(100) DEFAULT NULL,
           performed_by_user_id INT DEFAULT NULL,
           performed_by_name VARCHAR(255) DEFAULT NULL,
           reason VARCHAR(255) DEFAULT NULL,
           notes TEXT,
           previous_quantity DECIMAL(12,2) DEFAULT NULL,
           new_quantity DECIMAL(12,2) DEFAULT NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           KEY idx_invtx_item (inventory_item_id),
           KEY idx_invtx_type (transaction_type),
           KEY idx_invtx_created (created_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );

      // Columns added in later iterations (barcode/RFID, reorder targets, cost).
      await this.ensureColumn('inventory_items', 'reorder_quantity', 'DECIMAL(12,2) DEFAULT NULL');
      await this.ensureColumn('inventory_items', 'barcode', 'VARCHAR(100) DEFAULT NULL');
      await this.ensureColumn('inventory_items', 'rfid_tag', 'VARCHAR(100) DEFAULT NULL');
      await this.ensureColumn('inventory_items', 'unit_price', 'DECIMAL(12,4) DEFAULT NULL');
      await this.ensureColumn('inventory_requests', 'approved_by_user_id', 'INT DEFAULT NULL');
      await this.ensureColumn('inventory_requests', 'approved_by_name', 'VARCHAR(255) DEFAULT NULL');
      await this.ensureColumn('inventory_requests', 'approved_at', 'DATETIME DEFAULT NULL');
      await this.ensureColumn('inventory_transactions', 'unit_cost', 'DECIMAL(12,4) DEFAULT NULL');

      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_vendors (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           name VARCHAR(255) NOT NULL,
           contact_name VARCHAR(255) DEFAULT NULL,
           email VARCHAR(255) DEFAULT NULL,
           phone VARCHAR(50) DEFAULT NULL,
           address TEXT,
           categories VARCHAR(500) DEFAULT NULL,
           access_token VARCHAR(64) DEFAULT NULL,
           is_active TINYINT(1) NOT NULL DEFAULT 1,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           UNIQUE KEY uq_inventory_vendor_token (access_token)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           vendor_id INT DEFAULT NULL,
           po_number VARCHAR(50) DEFAULT NULL,
           status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
           order_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           expected_date DATE DEFAULT NULL,
           total_cost DECIMAL(14,2) DEFAULT 0,
           notes TEXT,
           created_by_user_id INT DEFAULT NULL,
           created_by_name VARCHAR(255) DEFAULT NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           KEY idx_po_vendor (vendor_id),
           KEY idx_po_status (status)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_purchase_order_items (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           purchase_order_id INT NOT NULL,
           inventory_item_id INT NOT NULL,
           quantity DECIMAL(12,2) NOT NULL,
           unit_cost DECIMAL(12,4) DEFAULT NULL,
           received_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           KEY idx_poi_po (purchase_order_id),
           KEY idx_poi_item (inventory_item_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );

      await this.ensureColumn('inventory_purchase_order_items', 'damaged_quantity', 'DECIMAL(12,2) NOT NULL DEFAULT 0');

      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_requests (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           request_number VARCHAR(50) DEFAULT NULL,
           department VARCHAR(100) DEFAULT NULL,
           status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
           requested_by_user_id INT DEFAULT NULL,
           requested_by_name VARCHAR(255) DEFAULT NULL,
           reason VARCHAR(255) DEFAULT NULL,
           notes TEXT,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           KEY idx_req_status (status),
           KEY idx_req_department (department)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS inventory_request_items (
           id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
           request_id INT NOT NULL,
           inventory_item_id INT NOT NULL,
           quantity DECIMAL(12,2) NOT NULL,
           approved_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           KEY idx_reqi_request (request_id),
           KEY idx_reqi_item (inventory_item_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      this.logger.log('Ensured inventory schema exists');
    } catch (err) {
      this.logger.warn(`Could not ensure inventory schema: ${err}`);
    }
  }

  private async ensureColumn(table: string, column: string, ddl: string): Promise<void> {
    try {
      const cols = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column],
      );
      if (Number(cols[0]?.cnt || 0) === 0) {
        await this.dataSource.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
        this.logger.log(`Added column ${table}.${column}`);
      }
    } catch (err) {
      this.logger.warn(`Could not ensure column ${table}.${column}: ${err}`);
    }
  }

  // ── Enrichment / status ────────────────────────────────────────────────

  private enrich(row: any, now = new Date()): any {
    const current = Number(row.current_quantity || 0);
    const minimum = Number(row.minimum_quantity || 0);
    const stockStatus = computeStockStatus(current, minimum);
    const expirationStatus = computeExpirationStatus(
      row.expiration_date,
      now,
      DEFAULT_EXPIRATION_ALERT_DAYS,
    );

    let status = stockStatus === 'IN_STOCK'
      ? 'In Stock'
      : stockStatus === 'LOW_STOCK'
        ? 'Low Stock'
        : stockStatus === 'NOT_STOCKED'
          ? 'Not Stocked'
          : 'Out of Stock';

    if (expirationStatus === 'EXPIRED') status = 'Expired';
    else if (expirationStatus === 'EXPIRING_SOON') status = 'Expiring Soon';

    return {
      ...row,
      current_quantity: current,
      minimum_quantity: minimum,
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
      unit_price: row.unit_price == null ? null : Number(row.unit_price),
      stock_status: stockStatus,
      expiration_status: expirationStatus,
      days_to_expiration: daysUntilExpiration(row.expiration_date, now),
      status,
      is_active: Number(row.is_active ?? 1) !== 0,
    };
  }

  private async getAllItems(): Promise<any[]> {
    const rows = await this.dataSource.query(
      `SELECT ${ITEM_COLUMNS} FROM inventory_items WHERE is_active = 1 ORDER BY item_name ASC`,
    );
    return rows.map((r: any) => this.enrich(r));
  }

  // ── Listing ────────────────────────────────────────────────────────────

  async list(filters: {
    search?: string;
    category?: string;
    department?: string;
    stockStatus?: string;
    expiration?: string;
    page?: number;
    pageSize?: number;
  }): Promise<any> {
    const all = await this.getAllItems();

    const term = (filters.search || '').toLowerCase().trim();
    const category = (filters.category || '').trim();
    const department = (filters.department || '').trim();
    const stockStatus = (filters.stockStatus || '').trim();
    const expiration = (filters.expiration || '').trim();

    const filtered = all.filter((it: any) => {
      if (term) {
        const hay = `${it.item_name} ${it.item_code || ''} ${it.lot_number || ''} ${it.supplier || ''} ${it.barcode || ''} ${it.rfid_tag || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (category && it.category !== category) return false;
      if (department && it.department !== department) return false;
      if (stockStatus && it.stock_status !== stockStatus) return false;
      if (expiration && it.expiration_status !== expiration) return false;
      return true;
    });

    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return { items, total, page, pageSize };
  }

  async getById(id: number): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT ${ITEM_COLUMNS} FROM inventory_items WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Inventory item #${id} not found`);
    return this.enrich(rows[0]);
  }

  /** Barcode / SKU scanning lookup (case-insensitive, matches barcode, SKU or name). */
  async lookupBarcode(code: string): Promise<any> {
    const q = String(code || '').trim();
    if (!q) throw new BadRequestException('Barcode or SKU is required');
    const qu = q.toUpperCase();
    const rows = await this.dataSource.query(
      `SELECT ${ITEM_COLUMNS} FROM inventory_items
       WHERE barcode = ? OR item_code = ? OR barcode = ? OR item_code = ? OR item_name = ?
       LIMIT 1`,
      [q, q, qu, qu, q],
    );
    if (!rows.length) throw new NotFoundException(`No inventory item found for "${q}"`);
    return this.enrich(rows[0]);
  }

  /** Normalize an item name for duplicate detection (case, spacing, punctuation, plurals). */
  private normalizeItemName(name: string): string {
    const SINGULAR: Record<string, string> = {
      capsules: 'capsule', tablets: 'tablet', tabs: 'tab', kits: 'kit', strips: 'strip',
      vials: 'vial', bottles: 'bottle', syringes: 'syringe', tubes: 'tube', masks: 'mask',
      gloves: 'glove', tests: 'test', injections: 'injection', solutions: 'solution',
      sets: 'set', packs: 'pack', bags: 'bag', pads: 'pad', needles: 'needle',
    };
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((w) => SINGULAR[w] || (w.length > 3 ? w.replace(/(ies|es)$/, (m) => (m === 'ies' ? 'y' : '')) : w))
      .join(' ');
  }

  /** Merge near-duplicate items (case/plural variants) and deactivate the extras. */
  private async dedupeInventory(): Promise<void> {
    try {
      const rows = await this.dataSource.query(
        `SELECT id, item_name, current_quantity, unit_price, unit_cost, barcode FROM inventory_items WHERE is_active = 1`,
      );
      const groups = new Map<string, any[]>();
      for (const r of rows) {
        const key = this.normalizeItemName(r.item_name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }

      let merged = 0;
      for (const [key, items] of groups) {
        if (items.length < 2) continue;
        const sorted = [...items].sort((a, b) => a.id - b.id);
        const keeper = sorted[0];
        const dupes = sorted.slice(1);

        let addQty = 0;
        let price = keeper.unit_price;
        for (const d of dupes) {
          addQty += Number(d.current_quantity || 0);
          if (price == null && d.unit_price != null) price = d.unit_price;
        }
        await this.dataSource.query(
          `UPDATE inventory_items SET current_quantity = current_quantity + ?, unit_price = COALESCE(unit_price, ?) WHERE id = ?`,
          [addQty, price, keeper.id],
        );

        const ids = dupes.map((d) => d.id);
        await this.dataSource.query(
          `UPDATE inventory_items SET is_active = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
        merged += dupes.length;
        this.logger.log(`Inventory dedupe: "${keeper.item_name}" absorbed ${dupes.length} duplicate(s) (${key})`);
      }
      if (merged) this.logger.log(`Inventory dedupe merged ${merged} duplicate item(s).`);
    } catch (err) {
      this.logger.warn(`Inventory dedupe skipped: ${err}`);
    }
  }

  async getCategories(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT category FROM inventory_items WHERE category IS NOT NULL AND category <> '' ORDER BY category ASC`,
    );
    return rows.map((r: any) => r.category);
  }

  async getDepartments(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT department FROM inventory_items WHERE department IS NOT NULL AND department <> '' ORDER BY department ASC`,
    );
    return rows.map((r: any) => r.department);
  }

  // ── Create / update ────────────────────────────────────────────────────

  async create(dto: any, user: InventoryUser): Promise<any> {
    const name = String(dto.item_name || '').trim();
    if (!name) throw new BadRequestException('Item name is required');
    if (!dto.category) throw new BadRequestException('Category is required');

    // Reject duplicates (case/plural-insensitive) to keep inventory clean.
    const activeItems = await this.dataSource.query(
      `SELECT id, item_name FROM inventory_items WHERE is_active = 1`,
    );
    const target = this.normalizeItemName(name);
    const dup = (activeItems as any[]).find(
      (r) => this.normalizeItemName(r.item_name) === target,
    );
    if (dup) {
      throw new BadRequestException(`"${name}" already exists as "${dup.item_name}"`);
    }

    const qty = Number(dto.quantity ?? dto.current_quantity ?? 0);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new BadRequestException('Quantity must be zero or a positive number');
    }
    const minQty = Number(dto.minimum_quantity ?? 0);
    if (!Number.isFinite(minQty) || minQty < 0) {
      throw new BadRequestException('Minimum quantity must be zero or a positive number');
    }
    const unitCost = dto.unit_cost == null || dto.unit_cost === ''
      ? null
      : Number(dto.unit_cost);
    if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      throw new BadRequestException('Unit cost must be zero or a positive number');
    }
    const unitPrice = dto.unit_price == null || dto.unit_price === ''
      ? null
      : Number(dto.unit_price);
    if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw new BadRequestException('Unit price must be zero or a positive number');
    }

    let result: any;
    try {
      result = await this.dataSource.query(
        `INSERT INTO inventory_items
           (item_name, item_code, description, category, department, storage_location,
            current_quantity, minimum_quantity, unit, unit_cost, unit_price, supplier, lot_number,
            expiration_date, reorder_quantity, barcode, rfid_tag, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          name,
          dto.item_code ? String(dto.item_code).trim().toUpperCase() : null,
          dto.description || null,
          String(dto.category).trim(),
          dto.department || null,
          dto.storage_location || null,
          qty,
          minQty,
          dto.unit || null,
          unitCost,
          unitPrice,
          dto.supplier || null,
          dto.lot_number || null,
          dto.expiration_date || null,
          dto.reorder_quantity != null && dto.reorder_quantity !== '' ? Number(dto.reorder_quantity) : null,
          dto.barcode || null,
          dto.rfid_tag || null,
        ],
      );
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
        throw new BadRequestException('Item code already exists — use a unique SKU');
      }
      throw err;
    }

    const id = result.insertId;
    // Auto-generate a scannable barcode when none is supplied.
    if (!dto.barcode) {
      await this.dataSource.query(
        `UPDATE inventory_items SET barcode = ? WHERE id = ?`,
        [`BC-${String(id).padStart(6, '0')}`, id],
      );
    }
    // Initial stock on creation is recorded as an audited RECEIVE.
    if (qty > 0) {
      await this.insertTransaction(this.dataSource, {
        inventoryItemId: id,
        type: 'RECEIVE',
        quantity: qty,
        sourceLocation: dto.supplier || 'Initial stock',
        destinationLocation: dto.department || null,
        user,
        reason: 'Initial stock on item creation',
        notes: dto.notes || null,
        previousQuantity: 0,
        newQuantity: qty,
      });
    }
    return this.getById(id);
  }

  // ── Price list import (Excel / CSV / Word) ─────────────────────────────

  /**
   * Parses an uploaded price-list document (columns: No, Description, Unit Price),
   * converts LRD → USD at the system exchange rate, matches each row to existing
   * inventory items and the system-wide billing price_catalog, and upserts prices.
   */
  async importPriceList(file: any, user: InventoryUser, sourceCurrency = 'LRD'): Promise<any> {
    if (!file || !file.buffer) throw new BadRequestException('File is required');
    const name = String(file.originalname || 'upload');
    const { rows, preview } = await this.parsePriceList(file);
    if (!rows.length) {
      throw new BadRequestException('No price rows found. Expected columns: No, Description, Unit Price.');
    }

    const settings = await this.billing.getBillingSettings();
    const rate = Number(settings.exchangeRate) || 193;
    const src = String(sourceCurrency || 'LRD').toUpperCase() === 'USD' ? 'USD' : 'LRD';

    const inventoryItems = await this.dataSource.query(
      `SELECT id, item_name, item_code, description FROM inventory_items WHERE is_active = 1`,
    );
    const catalogItems = await this.dataSource.query(
      `SELECT code, code_type, description FROM price_catalog WHERE active = 1`,
    );

    const slugify = (s: string) => String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    // "No" is only a real SKU when it contains letters (e.g. "GTS-50").
    // Pure row numbers (1, 2, 3 …) repeat per section, so derive a stable
    // unique code from the description instead.
    const makeCode = (no: any, idx: number, desc: string): string => {
      const raw = String(no ?? '').trim().replace(/\s+/g, '-').toUpperCase();
      if (raw && /[A-Z]/.test(raw) && raw !== 'NO') return raw.slice(0, 50);
      return (slugify(desc) || `MED-${idx + 1}`).toUpperCase();
    };

    const report: any[] = [];
    let catalogUpdated = 0;
    let catalogCreated = 0;
    let inventoryUpdated = 0;
    let inventoryCreated = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const desc = String(r.description || '').trim();
      const priceLRD = Number(r.unitPrice) || 0;
      if (!desc || !Number.isFinite(priceLRD) || priceLRD < 0) continue;
      // Skip document titles / section headings, not actual priced items.
      if (/^(price\s*list|price\s*listing|catalog|price\s*catalog)\b/i.test(desc)) continue;
      if (/^medication\s*price/i.test(desc)) continue;

      const feeUSD = src === 'USD'
        ? Math.round(priceLRD * 100) / 100
        : Math.round((priceLRD / rate) * 100) / 100;
      const category = this.inferCategory(desc);
      const defaultCodeType = ['pharmacy', 'room', 'general'].includes(category) ? 'HCPCS' : 'CPT4';

      // Reuse an existing service when the description matches one already in
      // the system-wide catalog; otherwise create a new catalog service.
      const catMatch = catalogItems.find(
        (c: any) => this.normalizeItemName(c.description) === this.normalizeItemName(desc),
      );
      const code = catMatch ? catMatch.code : makeCode(r.no, i, desc);
      const codeType = catMatch ? catMatch.code_type : defaultCodeType;

      // Upsert the system-wide billing price catalog (drives charges/receipts).
      await this.billing.createPriceCatalogItem({
        code,
        code_type: codeType,
        description: desc,
        category,
        cost: 0,
        fee: feeUSD,
        unit: 'each',
      });
      const catalogAction = catMatch ? 'updated' : 'created';
      if (catMatch) catalogUpdated++; else catalogCreated++;

      // Match / create the inventory item and set its selling price (match by
      // name/description only — numeric "No" values are not unique SKUs).
      const inv = inventoryItems.find((it: any) =>
        this.normalizeItemName(it.item_name) === this.normalizeItemName(desc) ||
        this.normalizeItemName(it.description) === this.normalizeItemName(desc),
      );
      let invAction: string | null;
      if (inv) {
        await this.dataSource.query(
          `UPDATE inventory_items SET unit_price = ?, unit = COALESCE(unit, 'each') WHERE id = ?`,
          [feeUSD, inv.id],
        );
        invAction = 'updated';
        inventoryUpdated++;
      } else {
        await this.dataSource.query(
          `INSERT INTO inventory_items
             (item_name, item_code, description, category, current_quantity, minimum_quantity, unit, unit_price, is_active)
           VALUES (?, ?, ?, ?, 0, 0, 'each', ?, 1)
           ON DUPLICATE KEY UPDATE
             item_name = VALUES(item_name),
             description = VALUES(description),
             category = VALUES(category),
             unit_price = VALUES(unit_price),
             unit = COALESCE(unit, 'each'),
             is_active = 1`,
          [desc, code, desc, category, feeUSD],
        );
        invAction = 'created';
        inventoryCreated++;
      }

      report.push({
        no: r.no ?? '',
        description: desc,
        category,
        unitPriceLRD: Math.round(priceLRD * 100) / 100,
        unitPriceUSD: feeUSD,
        inventory: invAction,
        catalog: catalogAction,
      });
    }

    if (report.length === 0) {
      this.logger.warn(
        `Price list import "${name}" parsed ${rows.length} rows but applied 0. Preview: ${JSON.stringify(preview)}`,
      );
    }

    return {
      fileName: name,
      sourceCurrency: src,
      systemCurrency: settings.currency || 'LRD',
      exchangeRate: rate,
      preview,
      totalRows: rows.length,
      applied: report.length,
      catalogUpdated,
      catalogCreated,
      inventoryUpdated,
      inventoryCreated,
      rows: report,
    };
  }

  /** Smart categorization based on the description text. */
  private inferCategory(desc: string): string {
    const d = ` ${String(desc || '').toLowerCase()} `;
    if (/\b(x-?ray|ultrasound|ct\b|mri|scan|imaging|radiology|mammogram)\b/.test(d)) return 'imaging';
    if (/\b(lab|test|panel|blood|cbc|urinalysis|culture|chemistry|specimen|venipuncture|hiv|malaria|typhoid|widal)\b/.test(d)) return 'lab';
    if (/\b(drug|medication|tablet|capsule|injection|syrup|suspension|cream|ointment|ampoule|vial|dose|ibuprofen|paracetamol|amoxicillin|aspirin|metformin|ciprofloxacin)\b/.test(d)) return 'pharmacy';
    if (/\b(room|bed|board|admission|overnight|night|ward)\b/.test(d)) return 'room';
    if (/\b(surgery|procedure|ecg|ekg|suture|biopsy|endoscopy|consult|visit|office|follow.?up|delivery|dressing)\b/.test(d)) return 'office';
    return 'general';
  }

  private async parsePriceList(
    file: any,
  ): Promise<{ rows: { no?: string; description: string; unitPrice: number }[]; preview: string }> {
    const buffer: Buffer = file.buffer;
    const ext = String(file.originalname || '').toLowerCase().split('.').pop() || '';
    let matrix: string[][] = [];
    let rawText: string | null = null;

    if (ext === 'docx') {
      matrix = await this.parseDocxToMatrix(buffer);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mammoth = require('mammoth');
      const raw = await mammoth.extractRawText({ buffer });
      rawText = String(raw.value || '');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      matrix = aoa.map((row) => row.map((c) => String(c ?? '').trim()));
      if (ext === 'txt') rawText = buffer.toString('utf8');
    }

    const cols = this.detectPriceColumns(matrix);
    let rows: { no?: string; description: string; unitPrice: number }[] = [];
    if (cols) {
      rows = this.rowsFromMatrix(matrix, cols);
    }

    // Fallbacks for non-tabular documents. Run both line-based parsers and keep
    // whichever yields the most rows (a title like "… 2025 / 2026" can otherwise
    // produce a single bogus row that masks the real stacked list below it).
    if (rawText) {
      const lineRows = this.parsePriceLinesFromText(rawText);
      const flatRows = this.parseFlatLines(rawText);
      const best = flatRows.length > lineRows.length ? flatRows : lineRows;
      if (best.length > rows.length) rows = best;
    }

    if (!rows.length) {
      throw new BadRequestException(
        'Could not detect the price columns. Please ensure the document has columns No, Description and Unit Price (or a header row followed by lines ending with a numeric price).',
      );
    }
    const preview = (rawText || matrix.map((row) => row.join('\t')).join('\n')).slice(0, 2000);
    return { rows, preview };
  }

  private rowsFromMatrix(
    matrix: string[][],
    cols: { headerIndex: number; noCol: number; descCol: number; priceCol: number },
  ): { no?: string; description: string; unitPrice: number }[] {
    const rows: { no?: string; description: string; unitPrice: number }[] = [];
    for (let i = cols.headerIndex + 1; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const desc = (cols.descCol >= 0 ? String(row[cols.descCol] || '') : '').trim();
      const priceRaw = cols.priceCol >= 0 ? String(row[cols.priceCol] || '') : '';
      const no = cols.noCol >= 0 ? String(row[cols.noCol] || '').trim() : '';
      if (!desc && !priceRaw) continue;
      const price = this.parseMoney(priceRaw);
      if (!desc && price == null) continue;
      rows.push({ no, description: desc, unitPrice: price ?? 0 });
    }
    return rows;
  }

  private parsePriceLinesFromText(
    text: string,
  ): { no?: string; description: string; unitPrice: number }[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows: { no?: string; description: string; unitPrice: number }[] = [];
    const lineRe = /^(.+?)\s+([\d][\d,]*\.?\d*)\s*$/;
    for (const line of lines) {
      const m = lineRe.exec(line);
      if (!m) continue;
      const price = this.parseMoney(m[2]);
      if (price == null) continue;
      const rest = m[1].trim();
      let no = '';
      let desc = rest;
      const noM = /^(\S+)\s+(.+)$/.exec(rest);
      if (noM && /\d/.test(noM[1]) && noM[2].trim()) {
        no = noM[1];
        desc = noM[2].trim();
      }
      if (!desc) continue;
      if (/^(no\.?|#|s\/?n|sl\s*no|code|item\s*no)$/i.test(desc)) continue;
      if (/^(description|item|service|particulars|name|drug|product|unit\s*price|price|rate|cost|amount|fee|charge)$/i.test(desc)) continue;
      if (/price\s*list|price\s*listing|catalog|medication\s*price/i.test(desc)) continue;
      rows.push({ no, description: desc, unitPrice: price });
    }
    return rows;
  }

  /**
   * Handles documents where each field sits on its own line, e.g.
   *   NO. / ORAL MEDICATIONS / UNIT PRICE
   *   1 / Amoxicillin 250mg capsule / 15.00
   *   2 / Amoxicillin 500mg capsule / 20.00
   */
  private parseFlatLines(
    text: string,
  ): { no?: string; description: string; unitPrice: number }[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows: { no?: string; description: string; unitPrice: number }[] = [];

    const isHeader = (l: string): boolean => {
      const s = l.trim();
      if (!s) return false;
      if (/^(no\.?|unit\s*price|price|description|item|s\/?n|sl\s*no|code)$/i.test(s)) return true;
      if (/price\s*list|price\s*listing|catalog/i.test(s)) return true;
      // ALL-CAPS section headings such as "ORAL MEDICATIONS", "INJECTABLES".
      if (/^[A-Z][A-Z\s&./-]{2,39}$/.test(s) && !/\d/.test(s)) return true;
      return false;
    };
    const isNo = (l: string): boolean => /^\d+$/.test(l.trim());
    const isPrice = (l: string): boolean => /^\d[\d,]*(\.\d+)?$/.test(l.trim());
    const isDesc = (l: string): boolean => !isHeader(l) && !isNo(l) && !isPrice(l);

    let i = 0;
    while (i < lines.length) {
      const a = lines[i];
      if (isHeader(a)) { i++; continue; }

      // No + Description + Price
      if (isNo(a) && i + 2 < lines.length && isDesc(lines[i + 1]) && isPrice(lines[i + 2])) {
        rows.push({ no: a, description: lines[i + 1], unitPrice: this.parseMoney(lines[i + 2]) ?? 0 });
        i += 3;
        continue;
      }

      // Description + Price (no No column)
      if (isDesc(a) && i + 1 < lines.length && isPrice(lines[i + 1])) {
        rows.push({ no: '', description: a, unitPrice: this.parseMoney(lines[i + 1]) ?? 0 });
        i += 2;
        continue;
      }

      i++;
    }
    return rows;
  }

  private async parseDocxToMatrix(buffer: Buffer): Promise<string[][]> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');

    // 1) Real Word tables → HTML <table> extraction.
    const html = await mammoth.convertToHtml({ buffer });
    const fromTables = this.extractDocxTables(String(html.value || ''));
    if (fromTables.length) return fromTables;

    // 2) Plain paragraphs / tab-separated lists → raw text (tabs between
    //    fields, blank lines between rows).
    const raw = await mammoth.extractRawText({ buffer });
    const text = String(raw.value || '');
    return text
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const tabs = line.split('\t').map((c) => c.trim());
        if (tabs.length > 1) return tabs;
        return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
      })
      .filter((cells) => cells.some((c) => c !== ''));
  }

  private extractDocxTables(html: string): string[][] {
    const tables: string[][] = [];
    const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tableRe.exec(html)) !== null) {
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(tm[1])) !== null) {
        const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        const cells: string[] = [];
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rm[1])) !== null) {
          cells.push(this.decodeHtml(String(cm[1]).replace(/<[^>]+>/g, '')).trim());
        }
        if (cells.length) tables.push(cells);
      }
    }
    return tables;
  }

  private decodeHtml(s: string): string {
    return s
      .replace(/&nbsp;/g, ' ')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, "'");
  }

  private detectPriceColumns(
    matrix: string[][],
  ): { headerIndex: number; noCol: number; descCol: number; priceCol: number } | null {
    const noRe = /^(no\.?|#|s\/?n|item\s*no|sl\s*no|code)$/i;
    const descRe = /(desc|item|service|name|drug|product)/i;
    const priceRe = /(price|rate|cost|amount|fee|charge)/i;
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const row = matrix[i] || [];
      let noCol = -1;
      let descCol = -1;
      let priceCol = -1;
      row.forEach((cell, c) => {
        const v = String(cell || '').trim();
        if (!v) return;
        if (noCol === -1 && noRe.test(v)) noCol = c;
        else if (descCol === -1 && descRe.test(v)) descCol = c;
        else if (priceCol === -1 && priceRe.test(v)) priceCol = c;
      });
      if (descCol >= 0 && priceCol >= 0) {
        return { headerIndex: i, noCol, descCol, priceCol };
      }
    }
    return null;
  }

  private parseMoney(s: string): number | null {
    if (s == null) return null;
    const t = String(s).trim().replace(/[^0-9.\-]/g, '');
    if (!t || t === '-' || t === '.') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  async update(id: number, dto: any, user: InventoryUser): Promise<any> {
    const existing = await this.getById(id);
    const fields: string[] = [];
    const vals: any[] = [];
    const map: Record<string, string> = {
      item_name: 'item_name',
      item_code: 'item_code',
      description: 'description',
      category: 'category',
      department: 'department',
      storage_location: 'storage_location',
      minimum_quantity: 'minimum_quantity',
      unit: 'unit',
      unit_cost: 'unit_cost',
      unit_price: 'unit_price',
      supplier: 'supplier',
      lot_number: 'lot_number',
      expiration_date: 'expiration_date',
      reorder_quantity: 'reorder_quantity',
      barcode: 'barcode',
      rfid_tag: 'rfid_tag',
      is_active: 'is_active',
    };

    for (const [key, col] of Object.entries(map)) {
      if (dto[key] === undefined) continue;
      if (key === 'item_name' && !String(dto[key]).trim()) {
        throw new BadRequestException('Item name is required');
      }
      if (key === 'item_code') {
        const code = String(dto[key] || '').trim();
        fields.push(`${col} = ?`);
        vals.push(code ? code.toUpperCase() : null);
        continue;
      }
      if (key === 'minimum_quantity') {
        const n = Number(dto[key]);
        if (!Number.isFinite(n) || n < 0) {
          throw new BadRequestException('Minimum quantity must be zero or a positive number');
        }
        fields.push(`${col} = ?`);
        vals.push(n);
        continue;
      }
      if (key === 'unit_cost') {
        const n = dto[key] === '' || dto[key] == null ? null : Number(dto[key]);
        if (n != null && (!Number.isFinite(n) || n < 0)) {
          throw new BadRequestException('Unit cost must be zero or a positive number');
        }
        fields.push(`${col} = ?`);
        vals.push(n);
        continue;
      }
      if (key === 'unit_price') {
        const n = dto[key] === '' || dto[key] == null ? null : Number(dto[key]);
        if (n != null && (!Number.isFinite(n) || n < 0)) {
          throw new BadRequestException('Unit price must be zero or a positive number');
        }
        fields.push(`${col} = ?`);
        vals.push(n);
        continue;
      }
      if (key === 'reorder_quantity') {
        const n = dto[key] === '' || dto[key] == null ? null : Number(dto[key]);
        if (n != null && (!Number.isFinite(n) || n < 0)) {
          throw new BadRequestException('Reorder quantity must be zero or a positive number');
        }
        fields.push(`${col} = ?`);
        vals.push(n);
        continue;
      }
      fields.push(`${col} = ?`);
      vals.push(dto[key]);
    }

    // NOTE: current_quantity is intentionally not editable here — every stock
    // change must flow through a transaction (receive/issue/transfer/return/adjust).

    if (!fields.length) return this.getById(id);
    vals.push(id);
    try {
      await this.dataSource.query(
        `UPDATE inventory_items SET ${fields.join(', ')} WHERE id = ?`,
        vals,
      );
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
        throw new BadRequestException('Item code already exists — use a unique SKU');
      }
      throw err;
    }
    return this.getById(id);
  }

  // ── Dashboard aggregates ───────────────────────────────────────────────

  async dashboard(): Promise<any> {
    const all = await this.getAllItems();
    const now = new Date();

    const total = all.length;
    const outOfStock = all.filter((i: any) => i.stock_status === 'OUT_OF_STOCK').length;
    const lowStock = all.filter((i: any) => i.stock_status === 'LOW_STOCK').length;
    const inStock = all.filter((i: any) => i.stock_status === 'IN_STOCK').length;
    const expired = all.filter((i: any) => i.expiration_status === 'EXPIRED').length;
    const expiringSoon = all.filter((i: any) => i.expiration_status === 'EXPIRING_SOON').length;
    const inventoryValue = all.reduce(
      (sum: number, i: any) => sum + (i.current_quantity || 0) * (i.unit_cost || 0),
      0,
    );

    const byCategoryMap: Record<string, number> = {};
    for (const it of all) {
      const cat = it.category || 'Other';
      byCategoryMap[cat] = (byCategoryMap[cat] || 0) + 1;
    }
    const byCategory = Object.entries(byCategoryMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const lowStockItems = all
      .filter((i: any) => i.stock_status === 'LOW_STOCK' || i.stock_status === 'OUT_OF_STOCK')
      .sort(compareByDepletion)
      .slice(0, 5);

    const expiring = await this.expiring();
    const recentActivity = await this.recentActivity(10);

    return {
      summary: {
        total,
        lowStock,
        outOfStock,
        expiringSoon,
        expired,
        inStock,
        inventoryValue: Number(inventoryValue.toFixed(2)),
      },
      health: {
        total,
        inStockCount: inStock,
        lowStockCount: lowStock,
        outOfStockCount: outOfStock,
        expiredCount: expired,
        inStockPercent: total ? Math.round((inStock / total) * 100) : 0,
      },
      byCategory,
      lowStock: lowStockItems,
      expiring,
      recentActivity,
    };
  }

  async lowStock(limit = 5): Promise<any[]> {
    const all = await this.getAllItems();
    return all
      .filter((i: any) => i.stock_status === 'LOW_STOCK' || i.stock_status === 'OUT_OF_STOCK')
      .sort(compareByDepletion)
      .slice(0, Math.max(1, Number(limit) || 5));
  }

  async expiring(): Promise<any> {
    const all = await this.getAllItems();
    const now = new Date();
    const within30 = all.filter(
      (i: any) =>
        i.expiration_status !== 'EXPIRED' &&
        i.days_to_expiration != null &&
        i.days_to_expiration >= 0 &&
        i.days_to_expiration <= 30,
    );
    const within60 = all.filter(
      (i: any) =>
        i.expiration_status !== 'EXPIRED' &&
        i.days_to_expiration != null &&
        i.days_to_expiration > 30 &&
        i.days_to_expiration <= 60,
    );
    const within90 = all.filter(
      (i: any) =>
        i.expiration_status !== 'EXPIRED' &&
        i.days_to_expiration != null &&
        i.days_to_expiration > 60 &&
        i.days_to_expiration <= 90,
    );
    const expired = all.filter((i: any) => i.expiration_status === 'EXPIRED');
    return { within30, within60, within90, expired };
  }

  // ── Transactions ───────────────────────────────────────────────────────

  async getTransactions(id: number): Promise<any[]> {
    return this.dataSource.query(
      `SELECT t.*, i.item_name, i.item_code, i.unit
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.inventory_item_id
       WHERE t.inventory_item_id = ?
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 200`,
      [id],
    );
  }

  async recentActivity(limit = 10): Promise<any[]> {
    const n = Math.min(100, Math.max(1, Number(limit) || 10));
    return this.dataSource.query(
      `SELECT t.id, t.inventory_item_id, t.transaction_type, t.quantity,
              t.source_location, t.destination_location, t.performed_by_name,
              t.reason, t.notes, t.previous_quantity, t.new_quantity, t.created_at,
              i.item_name, i.item_code, i.unit
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.inventory_item_id
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ?`,
      [n],
    );
  }

  // ── Stock operations (all transactional + audited) ────────────────────

  async receive(id: number, dto: any, user: InventoryUser): Promise<any> {
    const quantity = Number(dto.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Receive quantity must be a positive number');
    }
    return this.applyItemTransaction(id, 'RECEIVE', quantity, user, {
      source: dto.sourceLocation || dto.supplier || 'Supplier',
      destination: dto.destinationLocation || dto.department || null,
      reason: dto.reason || 'Stock received',
      notes: dto.notes || null,
    });
  }

  async issue(id: number, dto: any, user: InventoryUser): Promise<any> {
    const quantity = Number(dto.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Issue quantity must be a positive number');
    }
    return this.applyItemTransaction(id, 'ISSUE', quantity, user, {
      source: dto.sourceLocation || dto.department || null,
      destination: dto.destinationLocation || dto.issuedTo || null,
      reason: dto.reason || 'Stock issued',
      notes: dto.notes || null,
    });
  }

  async returnStock(id: number, dto: any, user: InventoryUser): Promise<any> {
    const quantity = Number(dto.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Return quantity must be a positive number');
    }
    return this.applyItemTransaction(id, 'RETURN', quantity, user, {
      source: dto.sourceLocation || dto.returnedFrom || null,
      destination: dto.destinationLocation || dto.department || null,
      reason: dto.reason || 'Stock returned',
      notes: dto.notes || null,
    });
  }

  async adjust(id: number, dto: any, user: InventoryUser): Promise<any> {
    if (dto.newQuantity === undefined || dto.newQuantity === null) {
      throw new BadRequestException('A target quantity is required for adjustments');
    }
    const target = Number(dto.newQuantity);
    if (!Number.isFinite(target) || target < 0) {
      throw new BadRequestException('Adjusted quantity cannot be negative');
    }
    if (!dto.reason || !String(dto.reason).trim()) {
      throw new BadRequestException('A reason is required for stock adjustments');
    }
    return this.dataSource.transaction(async (manager) => {
      const item = await this.getByIdForManager(manager, id);
      const current = Number(item.current_quantity || 0);
      const delta = target - current;
      const next = current + delta;

      await this.insertTransaction(manager, {
        inventoryItemId: id,
        type: 'ADJUSTMENT',
        quantity: Math.abs(delta) || 0,
        sourceLocation: item.department || null,
        destinationLocation: item.department || null,
        user,
        reason: String(dto.reason).trim(),
        notes: dto.notes || null,
        previousQuantity: current,
        newQuantity: next,
      });

      await manager.query(
        `UPDATE inventory_items SET current_quantity = ? WHERE id = ?`,
        [next, id],
      );
      return this.getByIdForManager(manager, id);
    });
  }

  async transfer(id: number, dto: any, user: InventoryUser): Promise<any> {
    const quantity = Number(dto.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Transfer quantity must be a positive number');
    }
    const destinationItemId = Number(dto.destinationItemId);
    if (!Number.isFinite(destinationItemId) || destinationItemId <= 0) {
      throw new BadRequestException('A destination item is required for a transfer');
    }
    if (destinationItemId === Number(id)) {
      throw new BadRequestException('Source and destination must be different items');
    }

    return this.dataSource.transaction(async (manager) => {
      const source = await this.getByIdForManager(manager, id);
      const dest = await this.getByIdForManager(manager, destinationItemId);

      const sourceCurrent = Number(source.current_quantity || 0);
      const destCurrent = Number(dest.current_quantity || 0);

      if (sourceCurrent < quantity) {
        throw new BadRequestException(
          `Insufficient stock: ${source.item_name} has only ${sourceCurrent} ${source.unit || 'units'} available`,
        );
      }

      const newSourceQty = sourceCurrent - quantity;
      const newDestQty = destCurrent + quantity;

      await this.insertTransaction(manager, {
        inventoryItemId: id,
        type: 'TRANSFER',
        quantity,
        sourceLocation: source.department || null,
        destinationLocation: dest.department || null,
        user,
        reason: dto.reason || `Transferred to ${dest.item_name}`,
        notes: dto.notes || null,
        previousQuantity: sourceCurrent,
        newQuantity: newSourceQty,
      });
      await manager.query(
        `UPDATE inventory_items SET current_quantity = ? WHERE id = ?`,
        [newSourceQty, id],
      );

      await this.insertTransaction(manager, {
        inventoryItemId: destinationItemId,
        type: 'TRANSFER',
        quantity,
        sourceLocation: source.department || null,
        destinationLocation: dest.department || null,
        user,
        reason: dto.reason || `Received from ${source.item_name}`,
        notes: dto.notes || null,
        previousQuantity: destCurrent,
        newQuantity: newDestQty,
      });
      await manager.query(
        `UPDATE inventory_items SET current_quantity = ? WHERE id = ?`,
        [newDestQty, destinationItemId],
      );

      return this.getByIdForManager(manager, id);
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async applyItemTransaction(
    id: number,
    type: TransactionType,
    quantity: number,
    user: InventoryUser,
    meta: { source?: string | null; destination?: string | null; reason?: string; notes?: string | null },
  ): Promise<any> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.getByIdForManager(manager, id);
      const current = Number(item.current_quantity || 0);

      let delta: number;
      let next: number;
      try {
        delta = resolveTransactionDelta(type, quantity, current).delta;
        next = applyStockChange(current, delta, false);
      } catch (err: any) {
        throw new BadRequestException(
          err?.message || 'Invalid stock transaction',
        );
      }

      await this.insertTransaction(manager, {
        inventoryItemId: id,
        type,
        quantity,
        sourceLocation: meta.source || null,
        destinationLocation: meta.destination || null,
        user,
        reason: meta.reason || type,
        notes: meta.notes || null,
        previousQuantity: current,
        newQuantity: next,
      });
      await manager.query(
        `UPDATE inventory_items SET current_quantity = ? WHERE id = ?`,
        [next, id],
      );
      return this.getByIdForManager(manager, id);
    });
  }

  private async getByIdForManager(manager: EntityManager, id: number): Promise<any> {
    const rows = await manager.query(
      `SELECT ${ITEM_COLUMNS} FROM inventory_items WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Inventory item #${id} not found`);
    return this.enrich(rows[0]);
  }

  private async insertTransaction(
    runner: DataSource | EntityManager,
    tx: {
      inventoryItemId: number;
      type: TransactionType;
      quantity: number;
      sourceLocation?: string | null;
      destinationLocation?: string | null;
      user: InventoryUser;
      reason?: string;
      notes?: string | null;
      previousQuantity: number;
      newQuantity: number;
      unitCost?: number | null;
    },
  ): Promise<void> {
    await runner.query(
      `INSERT INTO inventory_transactions
         (inventory_item_id, transaction_type, quantity, source_location,
           destination_location, performed_by_user_id, performed_by_name,
           reason, notes, previous_quantity, new_quantity, unit_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tx.inventoryItemId,
        tx.type,
        tx.quantity,
        tx.sourceLocation || null,
        tx.destinationLocation || null,
        tx.user?.id ?? null,
        tx.user?.displayName || null,
        tx.reason || null,
        tx.notes || null,
        tx.previousQuantity,
        tx.newQuantity,
        tx.unitCost ?? null,
      ],
    );
  }

  /**
   * Dispense / administer a medication: find the matching inventory item by
   * drug name and record an ISSUE transaction so stock decreases automatically.
   */
  async dispense(dto: any, user: InventoryUser): Promise<any> {
    const drug = String(dto.drug || '').trim();
    const quantity = Number(dto.quantity);
    if (!drug) throw new BadRequestException('Drug name is required');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Dispense quantity must be a positive number');
    }

    // Billing hold gate: a held prescription cannot be dispensed until billing clears it.
    if (dto.patient_id) {
      const holds = await this.dataSource.query(
        `SELECT id, description FROM billing_holds
         WHERE hold_type = 'pharmacy' AND pid = ? AND status = 'hold'
           AND (LOWER(description) LIKE ? OR ? LIKE CONCAT('%', LOWER(description), '%'))
         LIMIT 1`,
        [dto.patient_id, `%${drug.toLowerCase()}%`, drug.toLowerCase()],
      );
      if (holds.length) {
        throw new BadRequestException(
          `Billing hold: prescription "${holds[0].description || drug}" must be cleared by billing before it can be dispensed.`,
        );
      }
    }

    const rows = await this.dataSource.query(
      `SELECT id, item_name, department, unit, current_quantity
       FROM inventory_items
       WHERE is_active = 1 AND LOWER(item_name) LIKE ?
       ORDER BY current_quantity DESC LIMIT 1`,
      [`%${drug.toLowerCase()}%`],
    );
    if (!rows.length) {
      return { dispensed: false, itemId: null, itemName: null, message: `No inventory item matches "${drug}"` };
    }

    const item = rows[0];
    const updated = await this.applyItemTransaction(item.id, 'ISSUE', quantity, user, {
      source: item.department || null,
      destination: dto.destination || (dto.patient_id ? `Patient #${dto.patient_id}` : 'Patient use'),
      reason: dto.reason || `Dispensed: ${drug}${dto.patient_id ? ` (patient #${dto.patient_id})` : ''}`,
      notes: dto.notes || null,
    });
    return {
      dispensed: true,
      itemId: item.id,
      itemName: item.item_name,
      remaining: updated.current_quantity,
    };
  }

  // ── Vendors ─────────────────────────────────────────────────────────────

  async listVendors(): Promise<any[]> {
    return this.dataSource.query(
      `SELECT * FROM inventory_vendors ORDER BY name ASC`,
    );
  }

  async getVendor(id: number): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT * FROM inventory_vendors WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Vendor #${id} not found`);
    return rows[0];
  }

  async createVendor(dto: any): Promise<any> {
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Vendor name is required');
    const token = dto.access_token
      ? String(dto.access_token).trim()
      : `VND-${randomBytes(8).toString('hex').toUpperCase()}`;
    const result = await this.dataSource.query(
      `INSERT INTO inventory_vendors
         (name, contact_name, email, phone, address, categories, access_token, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        name,
        dto.contact_name || null,
        dto.email || null,
        dto.phone || null,
        dto.address || null,
        dto.categories || null,
        token,
      ],
    );
    return this.getVendor(result.insertId);
  }

  async updateVendor(id: number, dto: any): Promise<any> {
    await this.getVendor(id);
    const fields: string[] = [];
    const vals: any[] = [];
    const map: Record<string, string> = {
      name: 'name',
      contact_name: 'contact_name',
      email: 'email',
      phone: 'phone',
      address: 'address',
      categories: 'categories',
      is_active: 'is_active',
    };
    for (const [key, col] of Object.entries(map)) {
      if (dto[key] === undefined) continue;
      if (key === 'name' && !String(dto[key]).trim()) {
        throw new BadRequestException('Vendor name is required');
      }
      fields.push(`${col} = ?`);
      vals.push(dto[key]);
    }
    if (!fields.length) return this.getVendor(id);
    vals.push(id);
    await this.dataSource.query(
      `UPDATE inventory_vendors SET ${fields.join(', ')} WHERE id = ?`,
      vals,
    );
    return this.getVendor(id);
  }

  async getVendorByToken(token: string): Promise<any | null> {
    const rows = await this.dataSource.query(
      `SELECT * FROM inventory_vendors WHERE access_token = ? AND is_active = 1 LIMIT 1`,
      [token],
    );
    return rows[0] || null;
  }

  async getVendorPurchaseOrders(vendorId: number): Promise<any[]> {
    const pos = await this.dataSource.query(
      `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date,
              po.total_cost, po.notes
       FROM inventory_purchase_orders po
       WHERE po.vendor_id = ?
       ORDER BY po.created_at DESC LIMIT 100`,
      [vendorId],
    );
    for (const po of pos) {
      po.items = await this.dataSource.query(
        `SELECT poi.id, poi.inventory_item_id, poi.quantity, poi.unit_cost,
                poi.received_quantity, i.item_name, i.item_code, i.unit
         FROM inventory_purchase_order_items poi
         JOIN inventory_items i ON i.id = poi.inventory_item_id
         WHERE poi.purchase_order_id = ?
         ORDER BY poi.id ASC`,
        [po.id],
      );
    }
    return pos;
  }

  async acknowledgePurchaseOrder(id: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE inventory_purchase_orders SET status = 'SUBMITTED'
       WHERE id = ? AND status = 'DRAFT'`,
      [id],
    );
  }

  // ── Purchase orders ─────────────────────────────────────────────────────

  async listPurchaseOrders(): Promise<any[]> {
    const pos = await this.dataSource.query(
      `SELECT po.*, v.name AS vendor_name
       FROM inventory_purchase_orders po
       LEFT JOIN inventory_vendors v ON v.id = po.vendor_id
       ORDER BY po.created_at DESC LIMIT 200`,
    );
    for (const po of pos) {
      po.items = await this.dataSource.query(
        `SELECT poi.*, i.item_name, i.item_code, i.unit
         FROM inventory_purchase_order_items poi
         JOIN inventory_items i ON i.id = poi.inventory_item_id
         WHERE poi.purchase_order_id = ?
         ORDER BY poi.id ASC`,
        [po.id],
      );
    }
    return pos;
  }

  async getPurchaseOrder(id: number): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT po.*, v.name AS vendor_name
       FROM inventory_purchase_orders po
       LEFT JOIN inventory_vendors v ON v.id = po.vendor_id
       WHERE po.id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Purchase order #${id} not found`);
    const po = rows[0];
    po.items = await this.dataSource.query(
      `SELECT poi.*, i.item_name, i.item_code, i.unit
       FROM inventory_purchase_order_items poi
       JOIN inventory_items i ON i.id = poi.inventory_item_id
       WHERE poi.purchase_order_id = ?
       ORDER BY poi.id ASC`,
      [id],
    );
    return po;
  }

  async createPurchaseOrder(dto: any, user: InventoryUser): Promise<any> {
    const lines = dto.items || [];
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('At least one line item is required');
    }
    const vendorId = dto.vendor_id ? Number(dto.vendor_id) : null;
    if (dto.vendor_id != null && (!Number.isFinite(vendorId!) || vendorId! <= 0)) {
      throw new BadRequestException('Invalid vendor');
    }

    let totalCost = 0;
    const prepared: { itemId: number; qty: number; unitCost: number | null }[] = [];
    for (const line of lines) {
      const itemId = Number(line.inventory_item_id);
      const qty = Number(line.quantity);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        throw new BadRequestException('Invalid inventory item in order');
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException('Line quantity must be a positive number');
      }
      const itemRows = await this.dataSource.query(
        `SELECT id, unit_cost FROM inventory_items WHERE id = ? LIMIT 1`,
        [itemId],
      );
      if (!itemRows.length) {
        throw new BadRequestException(`Inventory item #${itemId} not found`);
      }
      const fallbackCost = itemRows[0].unit_cost == null ? null : Number(itemRows[0].unit_cost);
      const unitCost = line.unit_cost == null || line.unit_cost === ''
        ? fallbackCost
        : Number(line.unit_cost);
      if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) {
        throw new BadRequestException('Invalid unit cost');
      }
      totalCost += (unitCost || 0) * qty;
      prepared.push({ itemId, qty, unitCost });
    }

    const poNumber = dto.po_number
      ? String(dto.po_number).trim()
      : `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const result = await this.dataSource.query(
      `INSERT INTO inventory_purchase_orders
         (vendor_id, po_number, status, expected_date, total_cost, notes, created_by_user_id, created_by_name)
       VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
      [
        vendorId,
        poNumber,
        dto.expected_date || null,
        Number(totalCost.toFixed(2)),
        dto.notes || null,
        user?.id ?? null,
        user?.displayName || null,
      ],
    );
    const poId = result.insertId;
    for (const line of prepared) {
      await this.dataSource.query(
        `INSERT INTO inventory_purchase_order_items
           (purchase_order_id, inventory_item_id, quantity, unit_cost)
         VALUES (?, ?, ?, ?)`,
        [poId, line.itemId, line.qty, line.unitCost],
      );
    }
    return this.getPurchaseOrder(poId);
  }

  async updatePurchaseOrderStatus(id: number, status: string): Promise<any> {
    const allowed = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED'];
    if (!allowed.includes(status)) {
      throw new BadRequestException('Invalid purchase order status');
    }
    await this.getPurchaseOrder(id);
    await this.dataSource.query(
      `UPDATE inventory_purchase_orders SET status = ? WHERE id = ?`,
      [status, id],
    );
    return this.getPurchaseOrder(id);
  }

  /**
   * Receive a purchase order with receiving verification.
   * dto.lines may provide per-line { id, damagedQuantity, lotNumber, expirationDate }.
   * Good quantity is added to stock; damaged quantity is recorded (not added).
   */
  async receivePurchaseOrder(id: number, user: InventoryUser, dto?: any): Promise<any> {
    const po = await this.getPurchaseOrder(id);
    if (!po.items || po.items.length === 0) {
      throw new BadRequestException('Purchase order has no line items');
    }

    const lineConfig = new Map<number, any>();
    for (const c of dto?.lines || []) {
      if (c && Number(c.id) > 0) lineConfig.set(Number(c.id), c);
    }

    await this.dataSource.transaction(async (manager) => {
      for (const line of po.items) {
        const remaining = Number(line.quantity) - Number(line.received_quantity);
        if (remaining <= 0) continue;
        const cfg = lineConfig.get(Number(line.id)) || {};
        const damaged = Math.max(0, Math.min(remaining, Number(cfg.damagedQuantity) || 0));
        const good = remaining - damaged;

        const item = await this.getByIdForManager(manager, line.inventory_item_id);

        // Receiving verification: record lot/batch + expiration when supplied.
        if (cfg.lotNumber || cfg.expirationDate) {
          await manager.query(
            `UPDATE inventory_items SET lot_number = COALESCE(NULLIF(?, ''), lot_number),
               expiration_date = COALESCE(NULLIF(?, ''), expiration_date) WHERE id = ?`,
            [cfg.lotNumber || null, cfg.expirationDate || null, line.inventory_item_id],
          );
        }

        const current = Number(item.current_quantity || 0);
        const next = current + good;
        await this.insertTransaction(manager, {
          inventoryItemId: line.inventory_item_id,
          type: 'RECEIVE',
          quantity: good > 0 ? good : remaining,
          sourceLocation: po.vendor_name || 'Purchase order',
          destinationLocation: item.department || null,
          user,
          reason: `PO ${po.po_number} received`,
          notes: damaged > 0 ? `${damaged} damaged/not added to stock` : null,
          previousQuantity: current,
          newQuantity: good > 0 ? next : current,
          unitCost: line.unit_cost != null ? Number(line.unit_cost) : item.unit_cost,
        });
        if (good > 0) {
          await manager.query(
            `UPDATE inventory_items SET current_quantity = ? WHERE id = ?`,
            [next, line.inventory_item_id],
          );
        }
        await manager.query(
          `UPDATE inventory_purchase_order_items
           SET received_quantity = quantity, damaged_quantity = damaged_quantity + ?
           WHERE id = ?`,
          [damaged, line.id],
        );
      }
      await manager.query(
        `UPDATE inventory_purchase_orders SET status = 'RECEIVED' WHERE id = ?`,
        [id],
      );
    });
    return this.getPurchaseOrder(id);
  }

  // ── Inventory requests (department → approval → procurement) ─────────────

  async listRequests(): Promise<any[]> {
    const reqs = await this.dataSource.query(
      `SELECT r.*,
         (SELECT COUNT(*) FROM inventory_request_items ri WHERE ri.request_id = r.id) AS item_count
       FROM inventory_requests r
       ORDER BY r.created_at DESC LIMIT 200`,
    );
    for (const r of reqs) {
      r.items = await this.dataSource.query(
        `SELECT ri.*, i.item_name, i.item_code, i.unit
         FROM inventory_request_items ri
         JOIN inventory_items i ON i.id = ri.inventory_item_id
         WHERE ri.request_id = ? ORDER BY ri.id ASC`,
        [r.id],
      );
    }
    return reqs;
  }

  async getRequest(id: number): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT * FROM inventory_requests WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Request #${id} not found`);
    const r = rows[0];
    r.items = await this.dataSource.query(
      `SELECT ri.*, i.item_name, i.item_code, i.unit
       FROM inventory_request_items ri
       JOIN inventory_items i ON i.id = ri.inventory_item_id
       WHERE ri.request_id = ? ORDER BY ri.id ASC`,
      [id],
    );
    return r;
  }

  async createRequest(dto: any, user: InventoryUser): Promise<any> {
    const lines = dto.items || [];
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('At least one item is required');
    }
    const department = String(dto.department || '').trim();
    if (!department) throw new BadRequestException('Department is required');

    const requestNumber = dto.request_number
      ? String(dto.request_number).trim()
      : `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const result = await this.dataSource.query(
      `INSERT INTO inventory_requests
         (request_number, department, status, requested_by_user_id, requested_by_name, reason, notes)
       VALUES (?, ?, 'PENDING', ?, ?, ?, ?)`,
      [
        requestNumber,
        department,
        user?.id ?? null,
        user?.displayName || null,
        dto.reason || null,
        dto.notes || null,
      ],
    );
    const requestId = result.insertId;
    for (const line of lines) {
      const itemId = Number(line.inventory_item_id);
      const qty = Number(line.quantity);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        throw new BadRequestException('Invalid item in request');
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException('Request quantity must be a positive number');
      }
      await this.dataSource.query(
        `INSERT INTO inventory_request_items (request_id, inventory_item_id, quantity)
         VALUES (?, ?, ?)`,
        [requestId, itemId, qty],
      );
    }
    return this.getRequest(requestId);
  }

  async updateRequestStatus(id: number, status: string, user?: InventoryUser): Promise<any> {
    const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'ORDERED'];
    if (!allowed.includes(status)) {
      throw new BadRequestException('Invalid request status');
    }
    const req = await this.getRequest(id);

    if (status === 'APPROVED' || status === 'REJECTED') {
      // Record the approving user and timestamp.
      await this.dataSource.query(
        `UPDATE inventory_requests
         SET status = ?, approved_by_user_id = ?, approved_by_name = ?, approved_at = NOW()
         WHERE id = ?`,
        [status, user?.id ?? null, user?.displayName || null, id],
      );
      if (status === 'APPROVED') {
        await this.dataSource.query(
          `UPDATE inventory_request_items SET approved_quantity = quantity WHERE request_id = ?`,
          [id],
        );
        // Route the approved request to the pharmacy for fulfillment.
        await this.dataSource.query(
          `INSERT INTO pharmacy_alerts (pid, drug, message) VALUES (?, ?, ?)`,
          [
            0,
            req.request_number || `REQ-${id}`,
            `Inventory request ${req.request_number || `#${id}`} (${req.department || 'department'}) approved by ${user?.displayName || 'admin'} — route to pharmacy.`,
          ],
        );
      }
    } else {
      await this.dataSource.query(
        `UPDATE inventory_requests SET status = ? WHERE id = ?`,
        [status, id],
      );
    }
    return this.getRequest(id);
  }

  async orderRequest(id: number, user: InventoryUser): Promise<any> {
    const req = await this.getRequest(id);
    if (req.status !== 'APPROVED') {
      throw new BadRequestException('Only approved requests can be converted to a purchase order');
    }
    const items = (req.items || [])
      .filter((l: any) => Number(l.approved_quantity) > 0)
      .map((l: any) => ({ inventory_item_id: l.inventory_item_id, quantity: Number(l.approved_quantity) }));
    if (!items.length) {
      throw new BadRequestException('Request has no approved quantities');
    }
    const po = await this.createPurchaseOrder(
      { items, notes: `From request ${req.request_number}` },
      user,
    );
    await this.dataSource.query(
      `UPDATE inventory_requests SET status = 'ORDERED' WHERE id = ?`,
      [id],
    );
    return { request: await this.getRequest(id), purchaseOrder: po };
  }

  // ── Reorder / forecast / accounting ─────────────────────────────────────

  async getReorderSuggestions(): Promise<any[]> {
    const all = await this.getAllItems();
    return all
      .filter((i: any) => i.stock_status === 'LOW_STOCK' || i.stock_status === 'OUT_OF_STOCK')
      .map((i: any) => {
        const reorderTo = Number(i.reorder_quantity || 0) || i.minimum_quantity * 2;
        const suggestedQuantity = Math.max(0, reorderTo - i.current_quantity);
        return { ...i, reorder_to: reorderTo, suggested_quantity: suggestedQuantity };
      })
      // Most depleted first, shared with lowStock() and the dashboard list. This
      // used to sort ascending on suggested_quantity, which put the *smallest*
      // shortfall at the top of a list a buyer works down from the top.
      .sort(compareByDepletion);
  }

  async getForecast(days = 90): Promise<any[]> {
    const window = Math.min(365, Math.max(7, Number(days) || 90));
    const items = await this.getAllItems();
    const since = new Date(Date.now() - window * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    const issueRows = await this.dataSource.query(
      `SELECT inventory_item_id, SUM(quantity) AS qty
       FROM inventory_transactions
       WHERE transaction_type = 'ISSUE' AND created_at >= ?
       GROUP BY inventory_item_id`,
      [since],
    );
    const usageMap = new Map<number, number>();
    for (const r of issueRows) usageMap.set(Number(r.inventory_item_id), Number(r.qty));

    return items.map((i: any) => {
      const used = usageMap.get(i.id) || 0;
      const avgDaily = used / window;
      const daysRemaining = avgDaily > 0 ? Math.round(i.current_quantity / avgDaily) : null;
      const reorderTo = Number(i.reorder_quantity || 0) || i.minimum_quantity * 2;
      return {
        id: i.id,
        item_name: i.item_name,
        item_code: i.item_code,
        unit: i.unit,
        current_quantity: i.current_quantity,
        minimum_quantity: i.minimum_quantity,
        avg_daily_usage: Number(avgDaily.toFixed(3)),
        days_remaining: daysRemaining,
        projected_shortage: avgDaily > 0 && i.current_quantity <= i.minimum_quantity,
        suggested_reorder: Math.max(0, reorderTo - i.current_quantity),
      };
    });
  }

  async getAccountingSummary(): Promise<any> {
    const all = await this.getAllItems();
    const inventoryValue = all.reduce(
      (sum: number, i: any) => sum + (i.current_quantity || 0) * (i.unit_cost || 0),
      0,
    );
    const byCategoryValue: Record<string, number> = {};
    for (const i of all) {
      const cat = i.category || 'Other';
      byCategoryValue[cat] = (byCategoryValue[cat] || 0) + (i.current_quantity || 0) * (i.unit_cost || 0);
    }
    const poSpend = await this.dataSource.query(
      `SELECT COALESCE(SUM(total_cost), 0) AS total
       FROM inventory_purchase_orders
       WHERE status IN ('APPROVED', 'RECEIVED', 'PARTIALLY_RECEIVED')`,
    );
    const issuedCost = await this.dataSource.query(
      `SELECT COALESCE(SUM(quantity * COALESCE(unit_cost, 0)), 0) AS total
       FROM inventory_transactions WHERE transaction_type = 'ISSUE'`,
    );
    return {
      inventoryValue: Number(inventoryValue.toFixed(2)),
      byCategoryValue: Object.entries(byCategoryValue).map(([category, value]) => ({
        category,
        value: Number(value.toFixed(2)),
      })),
      purchaseOrderSpend: Number(poSpend[0].total || 0),
      issuedValue: Number(issuedCost[0].total || 0),
    };
  }

  private async seedVendors(): Promise<void> {
    try {
      const [{ cnt }] = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM inventory_vendors`,
      );
      if (Number(cnt) > 0) return;
      const vendors = [
        ['MedSupply Ltd', 'John Mensah', 'orders@medsupply.example', '+231 77 000 1001', 'Monrovia, Liberia', 'Medical Supplies, PPE'],
        ['PharmaCorp', 'Grace Kollie', 'sales@pharmacorp.example', '+231 77 000 1002', 'Monrovia, Liberia', 'Medication'],
        ['DiagTech', 'Samuel Doe', 'support@diagtech.example', '+231 77 000 1003', 'Monrovia, Liberia', 'Laboratory'],
        ['SafeGuard', 'Mary Johnson', 'hello@safeguard.example', '+231 77 000 1004', 'Monrovia, Liberia', 'PPE'],
      ];
      for (const v of vendors) {
        await this.dataSource.query(
          `INSERT INTO inventory_vendors
             (name, contact_name, email, phone, address, categories, access_token, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [...v, `VND-${randomBytes(8).toString('hex').toUpperCase()}`],
        );
      }
      this.logger.log('Seeded demo vendors');
    } catch (err) {
      this.logger.warn(`Vendor seed skipped: ${err}`);
    }
  }

  /**
   * Ensure the dedicated inventory-manager account exists so staff can log in
   * directly to the inventory dashboard with full inventory permissions.
   */
  /** Assign a barcode to any items that don't yet have one. */
  private async backfillBarcodes(): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE inventory_items
         SET barcode = CONCAT('BC-', LPAD(id, 6, '0'))
         WHERE barcode IS NULL OR barcode = ''`,
      );
    } catch (err) {
      this.logger.warn(`Barcode backfill skipped: ${err}`);
    }
  }

  private async ensureInventoryManagerUser(): Promise<void> {
    try {
      const [{ cnt }] = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM users WHERE BINARY username = 'inventory.manager'`,
      );
      if (Number(cnt) > 0) return;

      const hash = bcrypt.hashSync('OpenRx123!', 10);
      const result = await this.dataSource.query(
        `INSERT INTO users
           (username, fname, lname, title, active, registration_status, main_menu_role, password, authorized)
         VALUES ('inventory.manager', 'Inventory', 'Manager', 'Inventory Manager', 1, 'approved', 'inventory_manager', '', 1)`,
      );
      await this.dataSource.query(
        `INSERT INTO users_secure (id, username, password) VALUES (?, 'inventory.manager', ?)`,
        [result.insertId, hash],
      );
      this.logger.log('Seeded inventory manager user (inventory.manager)');
    } catch (err) {
      this.logger.warn(`Inventory manager user seed skipped: ${err}`);
    }
  }

  // ── Demo seed (idempotent — only when the table is empty) ──────────────

  private async seedDemoData(): Promise<void> {
    try {
      const [{ cnt }] = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM inventory_items`,
      );
      if (Number(cnt) > 0) return;

      const d = (days: number): string => {
        const dt = new Date();
        dt.setDate(dt.getDate() + days);
        return dt.toISOString().split('T')[0];
      };

      const items: any[][] = [
        ['Amoxicillin 500mg Capsules', 'AMX-500', 'Broad-spectrum antibiotic', 'Medication', 'Pharmacy', 'Shelf A-01', 1200, 200, 'capsules', 0.08, 'MedSupply Ltd', 'AMX-2026-01', d(120)],
        ['Acetaminophen 500mg Tablets', 'ACE-500', 'Analgesic / antipyretic', 'Medication', 'Pharmacy', 'Shelf A-02', 800, 150, 'tablets', 0.02, 'PharmaCorp', 'ACE-2026-03', d(180)],
        ['Omeprazole 20mg Capsules', 'OMP-20', 'Proton-pump inhibitor', 'Medication', 'Pharmacy', 'Shelf A-03', 320, 100, 'capsules', 0.12, 'PharmaCorp', 'OMP-2026-09', d(240)],
        ['Normal Saline 1L Bag', 'NS-1000', 'IV fluid', 'Medical Supplies', 'Emergency', 'Rack B-01', 250, 40, 'bags', 1.2, 'MedSupply Ltd', 'NS-2026-07', d(365)],
        ['Syringe 5mL', 'SYR-5', 'Disposable syringe', 'Medical Supplies', 'Nursing', 'Cart C-01', 0, 100, 'units', 0.04, 'MedSupply Ltd', 'SYR5-2026', d(900)],
        ['IV Cannula 20G', 'IVC-20', 'Peripheral cannula', 'Medical Supplies', 'Nursing', 'Cart C-02', 45, 80, 'units', 0.35, 'MedSupply Ltd', 'IVC-2026-06', d(300)],
        ['Gauze Pads 4x4', 'GAU-4', 'Sterile gauze', 'Medical Supplies', 'Emergency', 'Rack B-02', 200, 150, 'pads', 0.03, 'MedSupply Ltd', 'GAU-2026-08', d(500)],
        ['Surgical Gloves Medium', 'GLV-M', 'Sterile surgical gloves', 'PPE', 'General Store', 'Store D-01', 5000, 500, 'pairs', 0.05, 'SafeGuard', 'GLV-M-2026', d(720)],
        ['N95 Respirator Masks', 'N95-1860', 'Particulate respirator', 'PPE', 'General Store', 'Store D-02', 3000, 300, 'units', 0.75, 'SafeGuard', 'N95-2026-05', d(900)],
        ['Sterile Gloves (Exam)', 'STG-X', 'Examination gloves', 'PPE', 'Operating Room', 'OR E-01', 90, 50, 'pairs', 0.2, 'SafeGuard', 'STG-2025-01', d(-10)],
        ['Malaria Rapid Test Kit', 'MRT-01', 'RDT for Plasmodium', 'Laboratory', 'Laboratory', 'Lab F-01', 600, 100, 'kits', 0.9, 'DiagTech', 'MRT-2026-02', d(45)],
        ['Blood Collection Tubes', 'BCT-EDTA', 'EDTA vacuum tubes', 'Laboratory', 'Laboratory', 'Lab F-02', 1500, 250, 'tubes', 0.1, 'DiagTech', 'BCT-2026-04', d(400)],
        ['Malaria Smear Slides', 'MSS-01', 'Microscope slides', 'Laboratory', 'Laboratory', 'Lab F-03', 40, 60, 'slides', 0.15, 'DiagTech', 'MSS-2026-11', d(20)],
        ['Insulin Syringe 1mL', 'INS-1', 'U-100 insulin syringe', 'Medical Supplies', 'Pharmacy', 'Shelf A-04', 12, 50, 'units', 0.08, 'MedSupply Ltd', 'INS-2026-10', d(365)],
      ];

      const ids: number[] = [];
      for (const it of items) {
        const result = await this.dataSource.query(
          `INSERT INTO inventory_items
             (item_name, item_code, description, category, department, storage_location,
              current_quantity, minimum_quantity, unit, unit_cost, supplier, lot_number, expiration_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          it,
        );
        ids.push(result.insertId);
      }

      // Initial RECEIVE audit rows for each seeded item.
      for (let i = 0; i < ids.length; i++) {
        await this.insertTransaction(this.dataSource, {
          inventoryItemId: ids[i],
          type: 'RECEIVE',
          quantity: Number(items[i][7]),
          sourceLocation: items[i][10],
          destinationLocation: items[i][4],
          user: { displayName: 'System Seed' },
          reason: 'Initial stock',
          previousQuantity: 0,
          newQuantity: Number(items[i][7]),
        });
      }

      // A few realistic activity rows so the dashboard is populated.
      const extra = [
        { idx: 0, type: 'ISSUE' as const, qty: 25, dest: 'Emergency', reason: 'Issued to Emergency' },
        { idx: 3, type: 'ISSUE' as const, qty: 10, dest: 'Inpatient / Ward', reason: 'IV fluid for ward' },
        { idx: 10, type: 'TRANSFER' as const, qty: 10, dest: 'General Store', reason: 'Transferred from General Store to Laboratory' },
        { idx: 7, type: 'RETURN' as const, qty: 100, dest: 'General Store', reason: 'Returned unused stock' },
        { idx: 8, type: 'ISSUE' as const, qty: 200, dest: 'Outpatient', reason: 'Masks issued to Outpatient' },
      ];
      for (const e of extra) {
        const itemId = ids[e.idx];
        const row = await this.dataSource.query(
          `SELECT current_quantity, department FROM inventory_items WHERE id = ?`,
          [itemId],
        );
        const prev = Number(row[0].current_quantity);
        const next = e.type === 'ISSUE' || e.type === 'TRANSFER'
          ? prev - e.qty
          : prev + e.qty;
        await this.insertTransaction(this.dataSource, {
          inventoryItemId: itemId,
          type: e.type,
          quantity: e.qty,
          sourceLocation: e.type === 'TRANSFER' ? 'General Store' : row[0].department,
          destinationLocation: e.dest,
          user: { displayName: 'System Seed' },
          reason: e.reason,
          previousQuantity: prev,
          newQuantity: next,
        });
        await this.dataSource.query(
          `UPDATE inventory_items SET current_quantity = ? WHERE id = ?`,
          [next, itemId],
        );
      }

      this.logger.log('Seeded demo inventory data');
    } catch (err) {
      this.logger.warn(`Inventory seed skipped: ${err}`);
    }
  }
}

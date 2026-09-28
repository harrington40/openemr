import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type ImagingType = 'xray' | 'lab';

@Entity('imaging')
export class Imaging {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Patient ID */
  @Column({ type: 'int' })
  @Index()
  pid!: number;

  /** Encounter ID (optional) */
  @Column({ type: 'int', nullable: true })
  eid!: number | null;

  /** 'xray' or 'lab' */
  @Column({ length: 20 })
  @Index()
  type!: ImagingType;

  @Column({ length: 255 })
  originalName!: string;

  @Column({ length: 100 })
  mimeType!: string;

  @Column({ type: 'bigint' })
  sizeBytes!: number;

  /** Backblaze B2 file ID */
  @Column({ length: 255 })
  b2FileId!: string;

  /** Backblaze B2 path */
  @Column({ length: 500 })
  b2Path!: string;

  /** Description / notes */
  @Column({ length: 500, default: '' })
  description!: string;

  /** Who uploaded the image */
  @Column({ length: 100 })
  uploadedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

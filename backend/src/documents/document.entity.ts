import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

export type DocumentStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

@Entity('documents_secure')
export class Document {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ length: 255 })
    originalName!: string;

    @Column({ length: 100 })
    mimeType!: string;

    @Column({ type: 'bigint' })
    sizeBytes!: number;

    /** Backblaze B2 file ID */
    @Column({ length: 255 })
    b2FileId!: string;

    /** Backblaze B2 bucket + path */
    @Column({ length: 500 })
    b2Path!: string;

    /** Hashed 4-digit access code (bcrypt) */
    @Column({ length: 255 })
    accessCodeHash!: string;

    /** Plain 4-digit code — only visible to the uploading user */
    @Column({ length: 10, default: '' })
    plainCode!: string;

    /** Patient ID (0 = not patient-specific) */
    @Column({ type: 'int', default: 0 })
    @Index()
    pid!: number;

    /** Numeric user ID of the uploader (from JWT) */
    @Column({ type: 'int', default: 0 })
    @Index()
    uploaderUserId!: number;

    /** Who uploaded the document (display name) */
    @Column({ length: 100 })
    uploadedBy!: string;

    /** Email or phone to send the code to */
    @Column({ length: 255, default: '' })
    recipientContact!: string;

    /** Recipient name */
    @Column({ length: 255, default: '' })
    recipientName!: string;

    /** Document category / type */
    @Column({ length: 50, default: 'general' })
    category!: string;

    /** Document status */
    @Column({ length: 20, default: 'pending' })
    @Index()
    status!: DocumentStatus;

    /** Notes / description */
    @Column({ type: 'text', default: '' })
    notes!: string;

    /** Number of times accessed */
    @Column({ type: 'int', default: 0 })
    accessCount!: number;

    /** Last accessed timestamp */
    @Column({ type: 'datetime', nullable: true })
    lastAccessedAt!: Date | null;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}

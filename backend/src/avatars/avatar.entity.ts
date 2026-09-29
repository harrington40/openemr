import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('avatars')
export class Avatar {
    @PrimaryGeneratedColumn()
    id: number;

    /** User ID this avatar belongs to */
    @Column({ type: 'int', unique: true })
    @Index()
    userId: number;

    @Column({ length: 255 })
    originalName: string;

    @Column({ length: 100 })
    mimeType: string;

    @Column({ type: 'bigint' })
    sizeBytes: number;

    /** Backblaze B2 file ID */
    @Column({ length: 255 })
    b2FileId: string;

    /** Backblaze B2 path */
    @Column({ length: 500 })
    b2Path: string;

    @CreateDateColumn()
    createdAt: Date;
}

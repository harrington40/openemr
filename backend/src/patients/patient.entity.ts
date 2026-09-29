import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'patient_data' })
export class Patient {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    fname!: string;

    @Column()
    lname!: string;

    @Column()
    mname!: string;

    @Column({ type: 'date', nullable: true })
    DOB?: string;

    @Column({ nullable: true })
    sex?: string;

    @Column({ nullable: true })
    email?: string;

    @Column({ name: 'phone_contact', nullable: true })
    phone?: string;

    @Column({ nullable: true })
    street?: string;

    @Column({ nullable: true })
    city?: string;

    @Column({ nullable: true })
    state?: string;

    @Column({ name: 'postal_code', nullable: true })
    zip?: string;

    @Column({ nullable: true })
    status?: string;
}

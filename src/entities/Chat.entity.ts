import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ChatMember } from './ChatMember.entity';
import { User } from './User.entity';
import { ChatType } from '../common/constants';

@Entity('chats')
export class Chat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: ChatType.DIRECT,
  })
  type!: string;

  /**
   * Optional group name (NULL for DIRECT chats, populated for GROUP chats).
   */
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  name!: string | null;

  /**
   * Creator user ID for group chats (NULL for DIRECT chats).
   */
  @Column({
    type: 'uuid',
    nullable: true,
  })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdBy' })
  creator?: User | null;

  /**
   * Deterministic pair of participant UUIDs (e.g. `${userA}_${userB}` sorted).
   * Backed by a UNIQUE constraint in PostgreSQL to prevent duplicate direct chats even under concurrency.
   * Remains NULL for GROUP chats.
   */
  @Index({ unique: true })
  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
    nullable: true,
  })
  canonicalParticipants!: string | null;

  /**
   * Denormalized timestamp tracking the most recent message or activity in the chat.
   * Indexed for efficient ordering when listing user chats without distributed joins.
   */
  @Index()
  @Column({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  lastActivityAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ChatMember, (member) => member.chat, { cascade: true })
  members?: ChatMember[];
}

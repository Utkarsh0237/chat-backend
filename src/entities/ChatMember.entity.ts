import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Chat } from './Chat.entity';
import { User } from './User.entity';
import { ChatMemberRole } from '../common/constants';

@Entity('chat_members')
@Unique(['chatId', 'userId'])
@Index(['chatId', 'role'])
export class ChatMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  chatId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: ChatMemberRole.MEMBER,
  })
  role!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt!: Date;

  @ManyToOne(() => Chat, (chat) => chat.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat?: Chat;

  @ManyToOne(() => User, (user) => user.chatMembers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;
}

import { UserRepository } from './user.repository';
import { User } from '../../entities/User.entity';
import { NotFoundError, ConflictError } from '../../common/errors';

export class UserService {
  constructor(private userRepo = new UserRepository()) {}

  async createUser(data: { name: string; email: string }): Promise<User> {
    const existing = await this.userRepo.findByEmail(data.email);
    if (existing) {
      throw new ConflictError(`User with email "${data.email}" already exists`);
    }
    return this.userRepo.create(data);
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundError(`User with id "${id}" not found`);
    }
    return user;
  }

  /**
   * Validates that both users exist in PostgreSQL.
   * Throws NotFoundError if either user does not exist.
   */
  async validateUsersExist(userAId: string, userBId: string): Promise<[User, User]> {
    const users = await this.userRepo.findByIds([userAId, userBId]);
    const userA = users.find((u) => u.id === userAId);
    const userB = users.find((u) => u.id === userBId);

    if (!userA) {
      throw new NotFoundError(`User with id "${userAId}" does not exist`);
    }
    if (!userB) {
      throw new NotFoundError(`User with id "${userBId}" does not exist`);
    }

    return [userA, userB];
  }

  /**
   * Validates that every user ID in a list exists in PostgreSQL.
   * Deduplicates lookup keys and throws NotFoundError if any ID is missing.
   */
  async validateUsersListExist(userIds: string[]): Promise<User[]> {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const users = await this.userRepo.findByIds(uniqueIds);
    const foundMap = new Map(users.map((u) => [u.id, u]));

    for (const id of uniqueIds) {
      if (!foundMap.has(id)) {
        throw new NotFoundError(`User with id "${id}" does not exist`);
      }
    }

    return users;
  }
}

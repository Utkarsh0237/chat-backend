import { Repository, In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { User } from '../../entities/User.entity';

export class UserRepository {
  private repo: Repository<User>;

  constructor(dataSource = AppDataSource) {
    this.repo = dataSource.getRepository(User);
  }

  async findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email: email.toLowerCase() });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.repo.findBy({ id: In(ids) });
  }

  async create(userData: { name: string; email: string }): Promise<User> {
    const user = this.repo.create({
      name: userData.name,
      email: userData.email.toLowerCase(),
    });
    return this.repo.save(user);
  }
}

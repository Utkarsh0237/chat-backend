import { Request, Response, NextFunction } from 'express';
import { UserService } from './user.service';
import { enforceAuthenticatedActor } from '../../middleware/auth.middleware';

export class UserController {
  constructor(private userService = new UserService()) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.userService.createUser(req.body);
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: user,
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      enforceAuthenticatedActor(req, userId);

      const user = await this.userService.getUserById(userId);
      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  };
}

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RequestUser } from '../../common/types/request-user.type';
import { UsersRepository } from '../users/users.repository';
import { toUserResponse } from '../users/users.mapper';
import { toRegisterUserInput } from './auth.mapper';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly jwtExpiresIn: string;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.jwtExpiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? '7d';
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await this.usersRepository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersRepository.create(
      toRegisterUserInput(dto, passwordHash),
    );

    return this.buildAuthResponse(user.id, user.email, toUserResponse(user));
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersRepository.findByEmailForAuth(dto.email);

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const updatedUser = await this.usersRepository.updateLastLogin(user.id);

    return this.buildAuthResponse(
      updatedUser.id,
      updatedUser.email,
      toUserResponse(updatedUser),
    );
  }

  async me(user: RequestUser) {
    const existingUser = await this.usersRepository.findById(user.id);

    if (!existingUser) {
      throw new UnauthorizedException('User not found');
    }

    return toUserResponse(existingUser);
  }

  private buildAuthResponse(
    userId: string,
    email: string,
    user: AuthResponseDto['user'],
  ): AuthResponseDto {
    return {
      accessToken: this.jwtService.sign({ sub: userId, email }),
      tokenType: 'Bearer',
      expiresIn: this.jwtExpiresIn,
      user,
    };
  }
}

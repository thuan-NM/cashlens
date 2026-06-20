import { UserResponseDto } from '../../users/dto/user-response.dto';

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
  user: UserResponseDto;
};

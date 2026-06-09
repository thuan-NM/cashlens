export class UserResponseDto {
  id!: string;
  email!: string;
  fullName!: string | null;
  timezone!: string;
  locale!: string;
  baseCurrency!: string;
  status!: string;
  lastLogin!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

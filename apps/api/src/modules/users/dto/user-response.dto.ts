export class UserSettingsResponseDto {
  storeRawEmailBody!: boolean;
  allowAiInsights!: boolean;
  autoClassificationEnabled!: boolean;
  defaultMonthStartDay!: number;
  dataRetentionDays!: number | null;
  notificationEnabled!: boolean;
  metadata!: Record<string, unknown> | null;
}

export class UserResponseDto {
  id!: string;
  email!: string;
  fullName!: string | null;
  role!: string;
  timezone!: string;
  locale!: string;
  baseCurrency!: string;
  status!: string;
  lastLoginAt!: Date | null;
  settings!: UserSettingsResponseDto | null;
  createdAt!: Date;
  updatedAt!: Date;
}

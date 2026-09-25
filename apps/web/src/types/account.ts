/** A financial account as the API returns it (`GET /financial-accounts`). */
export interface ApiFinancialAccount {
  id: string;
  bankProviderId?: string | null;
  name: string;
  institutionName?: string | null;
  accountMask?: string | null;
  type: string;
  currency?: string;
  openingBalance?: number | null;
  currentBalance?: number | null;
  creditLimit?: number | null;
  isDefault?: boolean;
  status?: string;
}

/** A bank's email sender as the API returns it (`emailSenders` of a bank provider). */
export interface ApiBankEmailSender {
  id: string;
  senderEmail?: string | null;
  senderDomain?: string | null;
  senderName?: string | null;
  isVerified?: boolean;
  status?: string;
}

/** A bank provider as the API returns it (`GET /bank-providers`). */
export interface ApiBankProvider {
  id: string;
  code?: string | null;
  name: string;
  countryCode?: string | null;
  status?: string;
  emailSenders?: ApiBankEmailSender[];
}

/** A parser template as the API returns it (`GET /parser-templates`). */
export interface ApiParserTemplate {
  id: string;
  bankProviderId?: string | null;
  name: string;
  version?: number | string;
  isActive?: boolean;
}

export interface Category {
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  color: string;
}

/** A transaction category as the API returns it (`GET /transaction-categories`). */
export interface ApiCategory {
  id: string;
  name: string;
  type?: string | null;
  color?: string | null;
}

export interface Transaction {
  id: string;
  time: string;
  desc: string;
  merchant: string;
  bank: string;
  amount: number;
  dir: "income" | "expense" | "transfer";
  cat: string;
  src: "email" | "manual";
}

import type { TransactionCategory as ContractTransactionCategory } from "@repo/api-contract";

export interface Category {
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  color: string;
}

/** A transaction category as the API returns it (`GET /transaction-categories`): the API contract's type. */
export type ApiCategory = ContractTransactionCategory;

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

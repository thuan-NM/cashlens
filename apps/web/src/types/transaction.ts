export interface Category {
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  color: string;
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

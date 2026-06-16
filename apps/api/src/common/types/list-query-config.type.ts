export type ListFieldType = 'string' | 'number' | 'date' | 'boolean' | 'enum';

export type SortDirection = 'asc' | 'desc';

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'startswith'
  | 'endswith'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'null'
  | 'nnull';

export interface ListFieldConfig {
  type: ListFieldType;
  searchable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  operators?: FilterOperator[];
}

export type ListQueryConfig<TField extends string = string> = Record<
  TField,
  ListFieldConfig
>;

export interface Sorter<TField extends string = string> {
  field: TField;
  order: SortDirection;
}

export interface Filter<TField extends string = string> {
  field: TField;
  operator: FilterOperator;
  value?: unknown;
}

export interface ListQuery<TField extends string = string> {
  currentPage?: number;
  pageSize?: number;
  search?: string;
  sorters?: Sorter<TField>[];
  filters?: Filter<TField>[];
}

export interface ListResult<TItem> {
  data: TItem[];
  total: number;
}

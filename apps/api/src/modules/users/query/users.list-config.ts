import type { ListQueryConfig } from '../../../common/types/list-query-config.type';

export const usersListConfig = {
  id: {
    type: 'string',
    sortable: true,
    filterable: true,
  },
  email: {
    type: 'string',
    searchable: true,
    sortable: true,
    filterable: true,
  },
  fullName: {
    type: 'string',
    searchable: true,
    sortable: true,
    filterable: true,
  },
  timezone: {
    type: 'string',
    searchable: true,
    sortable: true,
    filterable: true,
  },
  locale: {
    type: 'string',
    searchable: true,
    sortable: true,
    filterable: true,
  },
  baseCurrency: {
    type: 'string',
    searchable: true,
    sortable: true,
    filterable: true,
  },
  status: {
    type: 'string',
    sortable: true,
    filterable: true,
  },
  lastLogin: {
    type: 'date',
    sortable: true,
    filterable: true,
  },
  createdAt: {
    type: 'date',
    sortable: true,
    filterable: true,
  },
  updatedAt: {
    type: 'date',
    sortable: true,
    filterable: true,
  },
} satisfies ListQueryConfig;

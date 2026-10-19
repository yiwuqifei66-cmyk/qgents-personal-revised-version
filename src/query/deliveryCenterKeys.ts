import type { DeliveryItemsFilters, DeliverySummaryFilters } from '@/types/delivery-center'

export const deliveryCenterKeys = {
  all: (projectId: string) => ['qgents', 'projects', projectId, 'delivery-center'] as const,
  items: (projectId: string, filters: DeliveryItemsFilters = {}) =>
    ['qgents', 'projects', projectId, 'delivery-center', 'items', filters] as const,
  summary: (projectId: string, filters: DeliverySummaryFilters = {}) =>
    ['qgents', 'projects', projectId, 'delivery-center', 'summary', filters] as const,
} as const

import type { DeliveryItem } from '@/types/delivery-center'
import { deliveryCenterFixtures } from './fixtures'

export interface DeliveryCenterStore {
  items: Map<string, DeliveryItem[]>
}

const runtimeProjectAliases: Record<string, string> = {
  'demo-project': 'project-delivery-center',
  'proj-001': 'project-delivery-center',
}

function seedItems(): Map<string, DeliveryItem[]> {
  const items = new Map<string, DeliveryItem[]>()
  for (const [projectId, projectItems] of Object.entries(deliveryCenterFixtures)) {
    items.set(projectId, structuredClone(projectItems))
  }
  for (const [projectId, sourceProjectId] of Object.entries(runtimeProjectAliases)) {
    const sourceItems = deliveryCenterFixtures[sourceProjectId]
    if (!sourceItems) continue
    items.set(projectId, structuredClone(sourceItems).map((item) => ({ ...item, projectId })))
  }
  return items
}

export function createDeliveryCenterStore(): DeliveryCenterStore {
  return { items: seedItems() }
}

export const deliveryCenterStore = createDeliveryCenterStore()

export function resetDeliveryCenterStore(): void {
  deliveryCenterStore.items.clear()
  for (const [projectId, items] of seedItems()) {
    deliveryCenterStore.items.set(projectId, items)
  }
}

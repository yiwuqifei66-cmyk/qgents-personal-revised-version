import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query'
import { deliveryCenterApi } from '@/api/deliveryCenter'
import type { DeliveryActionInput, DeliveryItemsFilters, DeliveryItemsResponse, DeliverySummaryFilters } from '@/types/delivery-center'
import { deliveryCenterKeys } from '@/query/deliveryCenterKeys'
import { taskModelQueryKeys } from '@/query/taskModelKeys'

export function useDeliveryItems(projectId: string, filters: DeliveryItemsFilters = {}) {
  return useQuery({
    queryKey: deliveryCenterKeys.items(projectId, filters),
    queryFn: () => deliveryCenterApi.list(projectId, filters),
    enabled: projectId.length > 0,
  })
}

export function useInfiniteDeliveryItems(
  projectId: string,
  filters: Omit<DeliveryItemsFilters, 'cursor'> = {},
): UseInfiniteQueryResult<InfiniteData<DeliveryItemsResponse, string | undefined>, Error> {
  return useInfiniteQuery({
    queryKey: deliveryCenterKeys.items(projectId, filters),
    queryFn: ({ pageParam }) => deliveryCenterApi.list(projectId, { ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.hasMore ? lastPage.page.nextCursor ?? undefined : undefined,
    enabled: Boolean(projectId),
  })
}

export function useDeliverySummary(projectId: string, filters: DeliverySummaryFilters = {}) {
  return useQuery({
    queryKey: deliveryCenterKeys.summary(projectId, filters),
    queryFn: () => deliveryCenterApi.summary(projectId, filters),
    enabled: projectId.length > 0,
  })
}

export function useDeliveryActionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DeliveryActionInput) => deliveryCenterApi.perform(input),
    onSuccess: (_response, input) => {
      void queryClient.invalidateQueries({ queryKey: deliveryCenterKeys.all(input.projectId) })
      void queryClient.invalidateQueries({ queryKey: ['qgents', 'projects', input.projectId, 'memories'] })
      void queryClient.invalidateQueries({ queryKey: ['qgents', 'projects', input.projectId, 'skills'] })
      void queryClient.invalidateQueries({ queryKey: ['memories', input.projectId] })
      void queryClient.invalidateQueries({ queryKey: ['skills', input.projectId] })
      void queryClient.invalidateQueries({ queryKey: ['qgents', 'projects', input.projectId, 'tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['qgents', 'projects', input.projectId, 'diff-reviews'] })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.tasks.all(input.projectId) })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.diffs.all(input.projectId) })
      void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.taskDiffReview.root(input.projectId) })
      // §30.3：AGENT 操作影响 Agent 团队列表与详情
      void queryClient.invalidateQueries({ queryKey: ['qgents', 'agents'] })
    },
    onError: (_error, input) => {
      void queryClient.invalidateQueries({ queryKey: deliveryCenterKeys.all(input.projectId) })
      if (input.item.resourceType === 'MEMORY') void queryClient.invalidateQueries({ queryKey: ['memories', input.projectId] })
      if (input.item.resourceType === 'SKILL') void queryClient.invalidateQueries({ queryKey: ['skills', input.projectId] })
      if (input.item.resourceType === 'CODE' && input.item.source.taskId) {
        void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.taskDiffReview.detail(input.projectId, input.item.source.taskId) })
        void queryClient.invalidateQueries({ queryKey: taskModelQueryKeys.tasks.detail(input.projectId, input.item.source.taskId) })
      }
      if (input.item.resourceType === 'AGENT') void queryClient.invalidateQueries({ queryKey: ['qgents', 'agents'] })
    },
  })
}

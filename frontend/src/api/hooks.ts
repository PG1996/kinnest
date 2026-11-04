import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from './client'

export type Role = 'admin' | 'caregiver' | 'viewer'
export type Me = {
  user: { id: string; email: string; name: string }
  family_id: string
  kid_id: string
  role: Role
}

/** Resolves to the signed-in member, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/api/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

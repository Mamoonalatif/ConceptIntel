/**
 * Fixed UUIDs matching backend/db/seed_users.sql. Used until the real
 * auth module is wired up and these can come from an actual logged-in user.
 */
export const MOCK_USER_IDS = {
  teacher: '00000000-0000-0000-0000-000000000001',
  student: '00000000-0000-0000-0000-000000000002',
  coordinator: '00000000-0000-0000-0000-000000000003',
  admin: '00000000-0000-0000-0000-000000000004',
  hod: '00000000-0000-0000-0000-000000000005',
} as const;

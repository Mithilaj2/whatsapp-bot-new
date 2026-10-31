'use client';
import { Suspense } from 'react';
import AccountsView from '@/components/accounts/AccountsView';

export default function Page() {
  return (
    <Suspense>
      <AccountsView tab="customers" />
    </Suspense>
  );
}

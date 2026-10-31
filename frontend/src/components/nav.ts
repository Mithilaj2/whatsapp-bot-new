import type { SvgIconComponent } from '@mui/icons-material';
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import CampaignOutlined from '@mui/icons-material/CampaignOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import type { AccountType } from '@/lib/api';

export interface NavLink {
  label: string;
  href: string;
  /** Not built yet: shown greyed out so people can see what's coming. */
  soon?: boolean;
}

export interface NavSection {
  label: string;
  icon: SvgIconComponent;
  href?: string;
  soon?: boolean;
  children?: NavLink[];
  /** Account types that can see this section. Everyone if omitted. */
  only?: AccountType[];
}

export const nav: NavSection[] = [
  { label: 'Dashboard', icon: GridViewOutlined, href: '/dashboard' },
  {
    label: 'Premium Campaigns',
    icon: CampaignOutlined,
    children: [
      { label: 'New campaign', href: '/campaigns/premium/new', soon: true },
      { label: 'Reports', href: '/campaigns/premium/reports', soon: true },
      { label: 'Incoming messages', href: '/campaigns/premium/inbox', soon: true },
    ],
  },
  {
    label: 'Branded Campaigns',
    icon: VerifiedOutlined,
    children: [
      { label: 'New campaign', href: '/campaigns/branded/new', soon: true },
      { label: 'Onboarding form', href: '/campaigns/branded/onboarding', soon: true },
      { label: 'Reports', href: '/campaigns/branded/reports', soon: true },
      { label: 'Auto responder', href: '/campaigns/branded/auto-responder', soon: true },
      { label: 'Incoming messages', href: '/campaigns/branded/inbox', soon: true },
      { label: 'Opt-outs', href: '/campaigns/branded/opt-outs', soon: true },
    ],
  },
  {
    label: 'Credits',
    icon: AccountBalanceWalletOutlined,
    children: [
      { label: 'Balances', href: '/credits/balances', soon: true },
      { label: 'Transactions', href: '/credits/transactions', soon: true },
    ],
  },
  { label: 'Bot Studio', icon: SmartToyOutlined, href: '/bots', soon: true },
  {
    label: 'Resellers & Customers',
    icon: StorefrontOutlined,
    only: ['ADMIN', 'RESELLER'],
    children: [
      { label: 'All', href: '/accounts' },
      { label: 'Resellers', href: '/accounts/resellers' },
      { label: 'Customers', href: '/accounts/customers' },
    ],
  },
  {
    label: 'Masters',
    icon: PublicOutlined,
    only: ['ADMIN', 'RESELLER'],
    children: [{ label: 'Countries', href: '/countries' }],
  },
];

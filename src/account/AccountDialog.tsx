import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import { X } from '../components/icons';
import { t } from '../i18n';
import { SyncPanel } from '../sync/SyncPanel';
import { ProfilePanel } from './ProfilePanel';
import { VaultPanel } from './VaultPanel';
import './account.css';

type AccountTab = 'profile' | 'vault' | 'sync';

/// One screen for "me": who I am, what paperwork I keep, and the optional
/// online account. It is reachable from the top bar on every platform, because
/// the user asked for it to be in plain sight rather than buried in settings.
export function AccountDialog({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<AccountTab>('profile');
  const tabs: TabItem<AccountTab>[] = [
    { id: 'profile', label: t('account.tabProfile') },
    { id: 'vault', label: t('account.tabVault') },
    { id: 'sync', label: t('account.tabSync') }
  ];

  return (
    <Dialog
      title={t('account.title')}
      ariaLabelledBy="account-title"
      onRequestClose={onClose}
      className="account-dialog"
      headerActions={
        <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="account-body">
        <Tabs idPrefix="account" label={t('account.title')} items={tabs} value={tab} onChange={setTab} />
        <TabPanel idPrefix="account" tabId="profile" active={tab === 'profile'}>
          <ProfilePanel />
        </TabPanel>
        <TabPanel idPrefix="account" tabId="vault" active={tab === 'vault'}>
          <VaultPanel />
        </TabPanel>
        <TabPanel idPrefix="account" tabId="sync" active={tab === 'sync'}>
          <SyncPanel />
        </TabPanel>
      </div>
    </Dialog>
  );
}

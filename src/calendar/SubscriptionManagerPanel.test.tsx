import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { setLanguage } from '../i18n';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionManagerPanel } from './SubscriptionManagerPanel';
import type { CalendarSubscription } from './subscription-model';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';

function sub(overrides: Partial<CalendarSubscription> = {}): CalendarSubscription {
  return {
    id: 's1', name: '家庭', url: 'https://example.com/a.ics', color: '#4FC9DA',
    categoryId: null,
    refreshIntervalMinutes: 15, provider: 'ics', accountId: null, remoteCalendarId: null,
    lastSyncedAt: null, lastAttemptedAt: null, lastStatus: null, lastError: null,
    createdAt: '', updatedAt: '', ...overrides
  };
}

function props(overrides = {}) {
  return {
    subscriptions: [sub()], onChanged: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(sub()), onUpdate: vi.fn().mockResolvedValue(sub()),
    onDelete: vi.fn().mockResolvedValue(undefined), onRefresh: vi.fn().mockResolvedValue(undefined),
    categories: [], onCreateCategory: vi.fn().mockResolvedValue(undefined),
    onUpdateCategory: vi.fn().mockResolvedValue(undefined), onDeleteCategory: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('SubscriptionManagerPanel', () => {
  it('updates subscription labels immediately when the language changes', () => {
    render(<SubscriptionManagerPanel {...props()} />);
    try {
      act(() => setLanguage('en'));
      expect(screen.getByRole('button', { name: 'Add subscription' })).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
    } finally {
      act(() => setLanguage('zh'));
    }
  });

  it('lists existing subscriptions', () => {
    render(<SubscriptionManagerPanel {...props()} />);
    expect(screen.getByText('家庭')).toBeInTheDocument();
  });

  it('removes redundant source guidance from the subscription form', () => {
    render(<SubscriptionManagerPanel {...props({ subscriptions: [] })} />);
    expect(screen.queryByText('如何获取 Google 日历链接')).not.toBeInTheDocument();
    expect(screen.queryByText('如何获取 Outlook 日历链接')).not.toBeInTheDocument();
    expect(screen.queryByText(/粘贴任意公开的 https:\/\/ 或 webcal:\/\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/勾选后将作为订阅显示在日历中/)).not.toBeInTheDocument();
  });

  it('creates a subscription from the form', async () => {
    const p = props({ subscriptions: [] });
    render(<SubscriptionManagerPanel {...p} />);
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '工作' } });
    fireEvent.change(screen.getByLabelText(/链接|URL/), { target: { value: 'https://x.com/b.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /添加订阅/ }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalled());
    expect(p.onChanged).toHaveBeenCalled();
  });

  it('disables add once the source cap is reached', () => {
    const many = Array.from({ length: 50 }, (_, index) => sub({ id: `s${index}` }));
    render(<SubscriptionManagerPanel {...props({ subscriptions: many })} />);
    expect(screen.getByRole('button', { name: /添加订阅/ })).toBeDisabled();
  });

  it('refreshes a subscription', async () => {
    const p = props();
    render(<SubscriptionManagerPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledWith('s1'));
  });

  it('tells the host when the delete confirmation takes over the top layer', () => {
    const onOverlayOpenChange = vi.fn();
    render(<SubscriptionManagerPanel {...props({ onOverlayOpenChange })} />);
    fireEvent.click(screen.getByRole('button', { name: '删除家庭' }));
    expect(onOverlayOpenChange).toHaveBeenCalledWith(true);
  });

  it('explains that this build has no OAuth credentials instead of echoing the native error', async () => {
    // A build compiled without client ids rejects the consent flow with the
    // `oauth` field; the panel turns that into guidance the user can act on.
    const repository = {
      listOAuthAccounts: vi.fn().mockResolvedValue([]),
      startOAuthLogin: vi.fn().mockRejectedValue({
        code: 'validation_error',
        field: 'oauth',
        message: 'Credentials are not configured for this provider.'
      })
    } as unknown as NowlyRepository;
    render(
      <RepositoryProvider repository={repository}>
        <SubscriptionManagerPanel {...props({ subscriptions: [] })} />
      </RepositoryProvider>
    );
    fireEvent.click(screen.getByLabelText('来源'));
    fireEvent.click(screen.getByRole('option', { name: 'Google 日历' }));
    fireEvent.click(screen.getByRole('button', { name: '连接账户' }));
    expect(await screen.findByText(/构建时没有配置 OAuth/)).toBeInTheDocument();
    expect(screen.queryByText('Credentials are not configured for this provider.')).not.toBeInTheDocument();
  });
});

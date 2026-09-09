import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '../src/components/ui/Dialog';

/**
 * Callers pass `onClose` as an inline arrow, so it changes identity on every
 * render. The dialog must not treat that as a reason to re-run its mount
 * effect, or typing in any field but the first bounces focus back to the first.
 */
function Host({ onClose = () => {} }: { onClose?: () => void }) {
  const [form, setForm] = useState({ name: '', endpoint: '' });
  return (
    <Dialog title="Register a server" onClose={() => onClose()}>
      <input
        aria-label="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        aria-label="Listen endpoint"
        value={form.endpoint}
        onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
      />
    </Dialog>
  );
}

describe('Dialog', () => {
  it('focuses the first control on open', () => {
    render(<Host />);
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('keeps focus in a later field while typing into it', async () => {
    const user = userEvent.setup();
    render(<Host />);

    const endpoint = screen.getByLabelText('Listen endpoint');
    await user.click(endpoint);
    await user.type(endpoint, 'vpn.example.com:51820');

    // Both assertions failed before the fix: focus jumped back to Name after
    // the first keystroke, so only one character ever landed.
    expect(endpoint).toHaveFocus();
    expect(endpoint).toHaveValue('vpn.example.com:51820');
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('still closes on Escape after the parent has re-rendered', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);

    // Re-render the parent so the `onClose` prop identity changes.
    await user.type(screen.getByLabelText('Name'), 'edge-fra-1');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

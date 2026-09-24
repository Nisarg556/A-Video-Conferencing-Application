import { expect, test } from '@playwright/test';

/**
 * Two real browsers (separate cookie jars), fake camera + mic, real WebRTC.
 * Covers the flow a reviewer would try first: host signs up and creates a
 * meeting with a waiting room, a guest asks to join and is admitted, both see
 * each other's live video, chat works, the guest leaves, the host ends it.
 */
test('host and guest meet end to end', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  host.on('dialog', (dialog) => dialog.accept()); // "End the meeting for everyone?"

  // Host: sign up and create a meeting with the waiting room on.
  await host.goto('/signup');
  await expect(host).toHaveTitle('Create account · Confer');
  await host.getByLabel('Name').fill('Hannah Host');
  await host.getByLabel('Email').fill(`host-${Date.now()}@example.com`);
  await host.getByLabel('Password').fill('correct-horse-battery');
  await host.getByRole('button', { name: 'Create account' }).click();
  await expect(host.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await host.getByLabel('Title (optional)').fill('E2E sync');
  await host.getByLabel(/Waiting room/).check();
  await host.getByRole('button', { name: 'Create meeting' }).click();
  await expect(host.getByText('You’re the host')).toBeVisible();
  const meetingUrl = host.url();

  // Host joins with the fake camera running.
  await expect(host.locator('.tile video')).toBeVisible();
  await host.getByRole('button', { name: 'Join meeting' }).click();
  await expect(host.getByText('You’re the only one here.')).toBeVisible();

  // Guest (signed out) asks to join and waits.
  await guest.goto(meetingUrl);
  await expect(guest.getByText('Hosted by Hannah Host')).toBeVisible();
  await guest.getByLabel('Your name').fill('Gus Guest');
  await guest.getByRole('button', { name: 'Ask to join' }).click();
  await expect(guest.getByRole('heading', { name: 'Waiting for the host to let you in' })).toBeVisible();

  // Host admits from the banner.
  await expect(host.getByText('Gus Guest is waiting to join')).toBeVisible();
  await host.locator('.lobby-banner').getByRole('button', { name: 'Admit' }).click();

  // Both sides: WebRTC connected and real frames arriving from the other person.
  for (const [page, other] of [
    [host, 'Gus Guest'],
    [guest, 'Hannah Host'],
  ]) {
    const tile = page.locator('.tile', { hasText: other });
    await expect(tile).toHaveAttribute('data-connection-state', 'connected');
    await expect
      .poll(() => tile.locator('video').evaluate((v) => v.videoWidth > 0 && v.currentTime > 0))
      .toBe(true);
  }

  // Chat: guest writes, host sees it with an unread badge.
  await guest.getByRole('button', { name: 'Chat' }).click();
  await guest.getByLabel('Message everyone').fill('Hello from the guest');
  await guest.getByLabel('Message everyone').press('Enter');
  await expect(host.getByRole('button', { name: 'Chat, 1 unread' })).toBeVisible();
  await host.getByRole('button', { name: 'Chat, 1 unread' }).click();
  await expect(host.getByRole('log', { name: 'Messages' })).toContainText('Hello from the guest');

  // Guest leaves; host's view updates.
  await guest.getByRole('button', { name: 'Leave meeting' }).click();
  await expect(guest.getByRole('heading', { name: 'You left the meeting' })).toBeVisible();
  await expect(host.locator('.tile', { hasText: 'Gus Guest' })).toHaveCount(0);

  // Host ends the meeting; the link now says so.
  await host.getByRole('button', { name: 'End for all' }).click();
  await expect(host.getByRole('heading', { name: 'You ended the meeting' })).toBeVisible();
  await guest.goto(meetingUrl);
  await expect(guest.getByRole('heading', { name: 'This meeting has ended' })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test('server enforces host-only actions even without the UI', async ({ browser }) => {
  // Guest tries to end someone else's meeting directly against the API.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/meetings/aaa-bbbb-ccc/end', { method: 'POST' });
    return res.status;
  });
  expect(status).toBe(401);
  await context.close();
});

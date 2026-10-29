import { config } from '../config.ts';
import { MockVoipMs } from './mock.ts';
import { VoipMsError, type CdrRecord, type DidInfo, type ResellerClient, type SubAccount, type VoicemailMessage, type VoipMs } from './types.ts';

const ENDPOINT = 'https://voip.ms/api/v1/rest.php';

// The one place the reseller API password is used. Nothing tenant-facing ever reaches this
// without going through the ownership checks in tenancy.ts first.
export class HttpVoipMs implements VoipMs {
  constructor(private username: string, private password: string, private fetchImpl: typeof fetch = fetch) {}

  private async call<T>(method: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams({ api_username: this.username, api_password: this.password, method, content_type: 'json' });
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const res = await this.fetchImpl(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new VoipMsError(method, `http_${res.status}`);
    const body = (await res.json()) as { status: string } & T;
    // "no_cdr", "no_messages" etc. mean an empty result, not a failure.
    if (body.status !== 'success' && !body.status.startsWith('no_')) throw new VoipMsError(method, body.status);
    return body;
  }

  // getIP skips the IP check, so it works before whitelisting and tells you which IP to whitelist.
  async getIP() {
    return (await this.call<{ ip: string }>('getIP')).ip;
  }

  async getBalance() {
    return (await this.call<{ balance: { current_balance: string } }>('getBalance')).balance.current_balance;
  }

  async getDIDsInfo(filter: { client?: string } = {}) {
    return (await this.call<{ dids?: DidInfo[] }>('getDIDsInfo', { client: filter.client })).dids ?? [];
  }

  // Fails with "no_reseller"-style statuses on accounts without reseller access; callers treat that as no clients.
  async getClients() {
    return (await this.call<{ clients?: ResellerClient[] }>('getClients')).clients ?? [];
  }

  async getCDR(p: { dateFrom: string; dateTo: string; timezone: number; account?: string }) {
    const r = await this.call<{ cdr?: CdrRecord[] }>('getCDR', {
      date_from: p.dateFrom, date_to: p.dateTo, timezone: p.timezone, account: p.account,
      answered: 1, noanswer: 1, busy: 1, failed: 1,
    });
    return r.cdr ?? [];
  }

  async sendSMS(p: { did: string; dst: string; message: string }) {
    return this.call<{ sms: string }>('sendSMS', p);
  }

  async getVoicemailMessages(p: { mailbox: string; folder?: string }) {
    // Passing folder=INBOX returned nothing on a live account, so it is only sent when asked for.
    const r = await this.call<{ messages?: VoicemailMessage[] }>('getVoicemailMessages', { mailbox: p.mailbox, folder: p.folder });
    return (r.messages ?? []).map((m) => ({ ...m, mailbox: String(m.mailbox) }));
  }

  async getVoicemailMessageFile(p: { mailbox: string; folder: string; messageNum: string }) {
    const r = await this.call<{ message: { data: string } }>('getVoicemailMessageFile', {
      mailbox: p.mailbox, folder: p.folder, message_num: p.messageNum, format: 'mp3',
    });
    return { format: 'mp3' as const, base64: r.message.data };
  }

  async getSubAccounts() {
    const r = await this.call<{ accounts?: SubAccount[] }>('getSubAccounts');
    return r.accounts ?? [];
  }

  async getRegistrationStatus(account: string) {
    const r = await this.call<{ registered: string }>('getRegistrationStatus', { account });
    return r.registered === 'yes';
  }
}

let instance: VoipMs | undefined;

export function voipms(): VoipMs {
  instance ??= config.voipms.mock ? new MockVoipMs() : new HttpVoipMs(config.voipms.username, config.voipms.password);
  return instance;
}

export function setVoipMs(v: VoipMs) {
  instance = v;
}

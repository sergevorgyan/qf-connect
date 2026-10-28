import type { CdrRecord, DidInfo, SubAccount, VoicemailMessage, VoipMs } from './types.ts';

// Deterministic fake account matching the seed data, so the portal and worker run end to end
// before the real API is enabled. A new call lands every poll so text-back can be watched live.
const DIDS = ['4155550100', '4155550101'];
const CALLERS = ['"MARIA LOPEZ" <4155557788>', '"JAMES CHEN" <6505551234>', '5105559876', '"PRIYA SHAH" <4085554321>'];
const DISPOSITIONS = ['ANSWERED', 'ANSWERED', 'NO ANSWER', 'ANSWERED', 'BUSY'];

function stamp(d: Date) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export class MockVoipMs implements VoipMs {
  sent: { did: string; dst: string; message: string }[] = [];
  private calls: CdrRecord[] = [];
  private seq = 0;

  constructor(now = new Date()) {
    for (let i = 24; i > 0; i--) this.addCall(new Date(now.getTime() - i * 47 * 60_000));
  }

  private addCall(at: Date) {
    const n = this.seq++;
    const disposition = DISPOSITIONS[n % DISPOSITIONS.length];
    this.calls.push({
      date: stamp(at),
      callerid: CALLERS[n % CALLERS.length],
      destination: DIDS[n % DIDS.length],
      description: 'Inbound DID',
      account: '100001_frontdesk',
      disposition,
      seconds: disposition === 'ANSWERED' ? String(30 + ((n * 37) % 400)) : '0',
      uniqueid: `mock-${n}`,
    });
  }

  async getIP() {
    return '203.0.113.10';
  }

  async getBalance() {
    return '25.00';
  }

  async getDIDsInfo(): Promise<DidInfo[]> {
    return DIDS.map((did, i) => ({ did, description: i ? 'Billing' : 'Main line', routing: 'account:100001_frontdesk', sms_enabled: '1' }));
  }

  async getCDR() {
    this.addCall(new Date());
    return [...this.calls];
  }

  async sendSMS(p: { did: string; dst: string; message: string }) {
    this.sent.push(p);
    return { sms: String(90000 + this.sent.length) };
  }

  async getVoicemailMessages({ mailbox }: { mailbox: string }): Promise<VoicemailMessage[]> {
    return [
      { mailbox, folder: 'INBOX', message_num: '1', date: stamp(new Date(Date.now() - 3_600_000)), callerid: CALLERS[1], duration: '00:00:24', listened: 'no' },
      { mailbox, folder: 'INBOX', message_num: '2', date: stamp(new Date(Date.now() - 86_400_000)), callerid: CALLERS[2], duration: '00:01:02', listened: 'yes' },
    ];
  }

  async getVoicemailMessageFile() {
    return { format: 'mp3' as const, base64: '' };
  }

  async getSubAccounts(): Promise<SubAccount[]> {
    return [
      { id: '1', account: '100001_frontdesk', description: 'Front desk' },
      { id: '2', account: '100001_drkim', description: 'Dr. Kim' },
    ];
  }

  async getRegistrationStatus(account: string) {
    return account.endsWith('frontdesk');
  }
}

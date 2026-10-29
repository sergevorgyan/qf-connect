// Shapes follow the VoIP.ms REST API (https://voip.ms/api/v1/rest.php). Field names are the API's own;
// confirm them against the method reference in the logged-in portal before going live.

export type Disposition = 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED';

export interface CdrRecord {
  date: string; // "2026-10-26 09:14:03" in the requested timezone
  callerid: string;
  destination: string;
  description: string;
  account: string;
  disposition: Disposition | string;
  seconds: string;
  uniqueid: string;
  call_logs?: string; // routing trace, e.g. "Failover to Voicemail 2002\nRouting to voicemail: 2002"
}

export interface VoicemailMessage {
  mailbox: string;
  folder: string;
  message_num: string;
  date: string;
  callerid: string;
  duration: string;
  listened: 'yes' | 'no';
}

export interface SubAccount {
  id: string;
  account: string; // "123456_frontdesk"
  description: string;
}

export interface DidInfo {
  did: string;
  description: string;
  routing: string;
  sms_enabled: string; // "1" or "0"
}

// A reseller client (Reseller > Manage Clients). Its numbers and sub-accounts stay in QF's main
// account; VoIP.ms just connects them to the client so they show in the white-label portal.
export interface ResellerClient {
  client: string; // client ID
  email: string;
  firstname?: string;
  lastname?: string;
  company?: string;
}

export interface VoipMs {
  getIP(): Promise<string>;
  getBalance(): Promise<string>;
  getDIDsInfo(filter?: { client?: string }): Promise<DidInfo[]>;
  getClients(): Promise<ResellerClient[]>;
  getCDR(params: { dateFrom: string; dateTo: string; timezone: number; account?: string }): Promise<CdrRecord[]>;
  sendSMS(params: { did: string; dst: string; message: string }): Promise<{ sms: string }>;
  getVoicemailMessages(params: { mailbox: string; folder?: string }): Promise<VoicemailMessage[]>;
  getVoicemailMessageFile(params: { mailbox: string; folder: string; messageNum: string }): Promise<{ format: 'mp3'; base64: string }>;
  getSubAccounts(): Promise<SubAccount[]>;
  getRegistrationStatus(account: string): Promise<boolean>;
}

export class VoipMsError extends Error {
  constructor(public method: string, public status: string) {
    super(`VoIP.ms ${method} failed: ${status}`);
  }
}

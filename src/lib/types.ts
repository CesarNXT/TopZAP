export type Contact = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  segment: 'Regular' | 'Inactive' | 'New';
  createdAt: any; // Can be string or Firestore Timestamp
  avatarUrl?: string;
  birthday?: string;
  blockedAt?: string; // ISO String
  lastReplyAt?: string; // ISO String
  notes?: string;
};

export type Campaign = {
  id: string;
  userId: string;
  name: string;
  sentDate: string;
  startDate?: string;
  endDate?: string;
  status: 'Sent' | 'Scheduled' | 'Draft' | 'Failed' | 'Sending' | 'Completed' | 'Paused';
  engagement: number;
  recipients: number;
  count?: number;
  stats?: {
    sent?: number;
    delivered?: number;
    read?: number;
    replied?: number;
    blocked?: number;
    failed?: number;
  };
  uazapiId?: string;
  batchIds?: string[];
  batches?: Record<string, {
    id: string;
    name: string;
    scheduledAt: string;
    status: string;
    count: number;
    stats?: {
        sent?: number;
        delivered?: number;
        read?: number;
        failed?: number;
    }
  }>;
};

export interface Instance {
  id: string;
  name: string;
  token: string;
}

export interface InstanceStatus {
  instanceId: string;
  status: 'disconnected' | 'connecting' | 'connected';
  createdAt?: string;
  qrCode?: string; // Base64 string for QR code
  pairCode?: string; // Pairing code
  phone?: string;
  profileName?: string;
  profilePictureUrl?: string;
}

export interface InitInstanceResponse {
  id: string;
  name: string;
  token: string;
  status: string;
  error?: string;
}

export interface ConnectInstanceResponse {
  status: string;
  qrCode?: string;
  pairCode?: string;
  error?: string;
}

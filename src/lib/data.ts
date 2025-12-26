import type { Campaign, Contact } from '@/lib/types';
import { PlaceHolderImages } from '@/lib/placeholder-images';

// This file now contains only placeholder or default data.
// The main data source will be Firestore.

export const contacts: Omit<Contact, 'id' | 'userId'>[] = [
  { name: 'Ana Silva', phone: '+55 11 98765-4321', segment: 'Regular', createdAt: new Date('2023-01-15').toISOString(), avatarUrl: PlaceHolderImages[0].imageUrl, birthday: '1990-05-20' },
  { name: 'João Santos', phone: '+55 21 91234-5678', segment: 'Regular', createdAt: new Date('2023-02-10').toISOString(), avatarUrl: PlaceHolderImages[1].imageUrl, birthday: '1985-08-12' },
  { name: 'Maria Costa', phone: '+55 31 99876-5432', segment: 'Inactive', createdAt: new Date('2023-03-05').toISOString(), avatarUrl: PlaceHolderImages[2].imageUrl, birthday: '1992-11-30' },
  { name: 'Pedro Oliveira', phone: '+55 41 98765-1234', segment: 'New', createdAt: new Date('2023-04-20').toISOString(), avatarUrl: PlaceHolderImages[3].imageUrl, birthday: '1988-03-15' },
  { name: 'Lucas Pereira', phone: '+55 51 91234-8765', segment: 'Regular', createdAt: new Date('2023-05-12').toISOString(), avatarUrl: PlaceHolderImages[4].imageUrl, birthday: '1995-07-22' },
  { name: 'Juliana Lima', phone: '+55 61 99876-2345', segment: 'Regular', createdAt: new Date('2023-06-01').toISOString(), avatarUrl: PlaceHolderImages[5].imageUrl, birthday: '1991-09-08' },
];

export const campaigns: Omit<Campaign, 'id' | 'userId'>[] = [
  { name: 'Promoção de Verão', sentDate: '2023-06-15', status: 'Sent', engagement: 85, recipients: 500 },
  { name: 'Lançamento Outono/Inverno', sentDate: '2023-09-01', status: 'Scheduled', engagement: 0, recipients: 1200 },
  { name: 'Newsletter Mensal - Maio', sentDate: '2023-05-30', status: 'Sent', engagement: 72, recipients: 850 },
];

export const chartData = [
    { month: 'Jan', sent: 400, opened: 240 },
    { month: 'Fev', sent: 300, opened: 139 },
    { month: 'Mar', sent: 200, opened: 180 },
    { month: 'Abr', sent: 278, opened: 190 },
    { month: 'Mai', sent: 189, opened: 120 },
    { month: 'Jun', sent: 239, opened: 180 },
    { month: 'Jul', sent: 349, opened: 210 },
];

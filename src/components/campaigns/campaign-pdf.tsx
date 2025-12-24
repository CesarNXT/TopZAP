'use client';

import React from 'react';
// Note: @react-pdf/renderer is removed, so this component will not render a PDF.
// The types and registry are commented out to prevent build errors.

// import {
//   Page,
//   Text,
//   View,
//   Document,
//   StyleSheet,
//   Font,
// } from '@react-pdf/renderer';

type ReportData = {
  campaignName: string;
  date: string;
  stats: {
    total: number;
    success: number;
    failed: number;
    economySaved: string;
  };
  contacts: {
    name: string;
    phone: string;
    status: string;
  }[];
};

// // Register fonts
// Font.register({
//     family: 'Inter',
//     fonts: [
//       { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2', fontWeight: 400 },
//       { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2', fontWeight: 500 },
//       { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2', fontWeight: 700 },
//     ],
//   });

const styles = {
  page: {
    fontFamily: 'Inter',
    fontSize: 10,
    padding: 30,
    color: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eaeaea',
    paddingBottom: 10,
  },
  logo: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#25D366',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  economyCard: {
    backgroundColor: '#dcfce7',
    padding: 15,
    borderRadius: 5,
    textAlign: 'center',
    marginBottom: 20,
  },
  economyText: {
    fontSize: 12,
    marginBottom: 4,
  },
  economyValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#166534',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  statBox: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
  },
  table: {
    display: 'flex',
    width: 'auto',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#eaeaea',
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableColHeader: {
    width: '33.33%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#eaeaea',
    backgroundColor: '#f8f8f8',
    padding: 5,
    fontWeight: 'bold',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tableCol: {
    width: '33.33%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#eaeaea',
    padding: 5,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  statusSuccess: {
    color: '#16a34a',
  },
  statusFailed: {
    color: '#dc2626',
  },
  footer: {
    position: 'absolute',
    bottom: 15,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 8,
    color: '#aaa',
  },
};

// Dummy component as @react-pdf/renderer is removed
export const CampaignPDF = ({ data }: { data: ReportData }) => {
    return <div>PDF generation is temporarily disabled.</div>;
}

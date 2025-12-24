'use client';

import React from 'react';
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Font,
  Image,
} from '@react-pdf/renderer';

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

// Registrar fontes para um visual mais profissional.
// Usaremos a Inter, que já faz parte do design do sistema.
Font.register({
    family: 'Inter',
    fonts: [
      { src: 'https://rsms.me/inter/font-files/Inter-Regular.woff', fontWeight: 400 },
      { src: 'https://rsms.me/inter/font-files/Inter-SemiBold.woff', fontWeight: 600 },
      { src: 'https://rsms.me/inter/font-files/Inter-Bold.woff', fontWeight: 700 },
    ],
});

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Inter',
    fontSize: 10,
    padding: '40px 35px',
    color: '#334155', // slate-700
    backgroundColor: '#f8fafc', // slate-50
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 25,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0', // slate-200
  },
  logo: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#25D366',
    fontFamily: 'Inter',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a', // slate-900
  },
  economyCard: {
    backgroundColor: '#dcfce7', // green-100
    padding: 15,
    borderRadius: 8,
    textAlign: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#bbf7d0', // green-200
  },
  economyText: {
    fontSize: 12,
    color: '#15803d', // green-700
    marginBottom: 4,
    fontWeight: 600,
  },
  economyValue: {
    fontSize: 22,
    fontWeight: 700,
    color: '#166534', // green-800
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 25,
    backgroundColor: '#fff',
    padding: '15px 10px',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9', // slate-100
  },
  statBox: {
    textAlign: 'center',
    width: '25%',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 9,
    color: '#64748b', // slate-500
    marginTop: 2,
    textTransform: 'uppercase',
  },
  table: {
    display: 'flex',
    width: 'auto',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fff',
  },
  tableColHeader: {
    width: '33.33%',
    padding: '8px 6px',
    fontWeight: 600,
    color: '#475569', // slate-600
    backgroundColor: '#f8fafc', // slate-50
    borderBottomWidth: 2,
    borderBottomColor: '#e2e8f0',
  },
  tableCol: {
    width: '33.33%',
    padding: '8px 6px',
  },
  statusSuccess: {
    color: '#16a34a', // green-600
    fontWeight: 600,
  },
  statusFailed: {
    color: '#dc2626', // red-600
    fontWeight: 600,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 35,
    right: 35,
    textAlign: 'center',
    fontSize: 8,
    color: '#94a3b8', // slate-400
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 10,
    color: '#1e293b' // slate-800
  }
});

export const CampaignPDF = ({ data }: { data: ReportData }) => {
    return (
    <Document title={`Relatório - ${data.campaignName}`} author="TOPzap">
        <Page size="A4" style={styles.page}>
            <View style={styles.header}>
                <Text style={styles.logo}>TOPzap</Text>
                <View>
                    <Text style={styles.headerTitle}>{data.campaignName}</Text>
                    <Text style={{textAlign: 'right', fontSize: 9, color: '#64748b', paddingTop: 2}}>{data.date}</Text>
                </View>
            </View>

            <View style={styles.economyCard}>
                <Text style={styles.economyText}>Economia Estimada vs. API Oficial</Text>
                <Text style={styles.economyValue}>{data.stats.economySaved}</Text>
            </View>

            <Text style={styles.sectionTitle}>Resumo da Campanha</Text>
            <View style={styles.statsContainer}>
                <View style={styles.statBox}>
                    <Text style={styles.statValue}>{data.stats.total}</Text>
                    <Text style={styles.statLabel}>Total de Envios</Text>
                </View>
                <View style={styles.statBox}>
                    <Text style={{...styles.statValue, color: '#16a34a'}}>{data.stats.success}</Text>
                    <Text style={styles.statLabel}>Sucesso</Text>
                </View>
                <View style={styles.statBox}>
                    <Text style={{...styles.statValue, color: '#dc2626'}}>{data.stats.failed}</Text>
                    <Text style={styles.statLabel}>Falhas</Text>
                </View>
                 <View style={styles.statBox}>
                    <Text style={styles.statValue}>{((data.stats.success / data.stats.total) * 100).toFixed(0)}%</Text>
                    <Text style={styles.statLabel}>Taxa de Sucesso</Text>
                </View>
            </View>
            
            <Text style={styles.sectionTitle}>Status de Entrega por Contato</Text>
            <View style={styles.table}>
                {/* Table Header */}
                <View style={styles.tableRow}>
                    <Text style={styles.tableColHeader}>Nome</Text>
                    <Text style={styles.tableColHeader}>Telefone</Text>
                    <Text style={styles.tableColHeader}>Status</Text>
                </View>

                {/* Table Body */}
                {data.contacts.map((contact, index) => (
                    <View key={index} style={{...styles.tableRow, backgroundColor: index % 2 === 1 ? '#f8fafc' : '#fff'}}>
                        <Text style={styles.tableCol}>{contact.name}</Text>
                        <Text style={styles.tableCol}>{contact.phone}</Text>
                        <Text style={[styles.tableCol, contact.status === 'Sucesso' ? styles.statusSuccess : styles.statusFailed]}>
                            {contact.status}
                        </Text>
                    </View>
                ))}
            </View>

            <Text style={styles.footer}>
                Relatório gerado por TOPzap. Sistema de automação não-oficial. Use com moderação.
            </Text>
        </Page>
    </Document>
    );
};

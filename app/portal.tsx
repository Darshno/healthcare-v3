import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { portalLogin, getPortalToken, clearPortalToken } from "@/lib/health/portalAuth";
import type { Priority, VaccinationRecord } from "@/lib/health/types";
import { VACCINES } from "@/lib/health/types";

const priorityTone: Record<Priority, { bg: string; fg: string }> = {
  emergency: { bg: "#FDECEC", fg: "#B42318" },
  urgent: { bg: "#FFF4E5", fg: "#9A5B00" },
  priority: { bg: "#EAF4FF", fg: "#2369A5" },
  routine: { bg: "#EEF6F0", fg: "#198754" },
};

const statusText: Record<string, string> = {
  waiting: "Waiting",
  called: "In consultation",
  completed: "Completed",
  paused: "Paused",
  transferred: "Transferred",
};

export default function PortalScreen() {
  const isWeb = Platform.OS === "web";
  const [openId, setOpenId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    setToken(getPortalToken());
  }, []);

  const handleLogin = useCallback(async () => {
    if (!openId.trim()) {
      setLoginError("Enter your staff Open ID.");
      return;
    }
    setBusy(true);
    setLoginError(null);
    try {
      await portalLogin(openId.trim());
      setToken(getPortalToken());
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }, [openId]);

  const handleLogout = useCallback(() => {
    clearPortalToken();
    setToken(null);
  }, []);

  if (!isWeb) {
    return (
      <View style={styles.center}>
        <MaterialIcons name="language" size={40} color="#18332F" />
        <Text style={styles.centerTitle}>Doctor portal</Text>
        <Text style={styles.centerBody}>
          This console is designed for the web dashboard. On a mobile device, use the queue tab in the app instead.
        </Text>
      </View>
    );
  }

  if (!token) {
    return (
      <View style={[styles.center, { backgroundColor: "#F7F8F5" }]}>
        <View style={styles.brandRow}>
          <MaterialIcons name="medical-services" size={26} color="#087E7B" />
          <Text style={styles.brandTitle}>Rural Health · Doctor Console</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Staff sign-in</Text>
          <Text style={styles.label}>Staff Open ID</Text>
          <TextInput
            value={openId}
            onChangeText={setOpenId}
            autoCapitalize="none"
            placeholder="e.g. dr.asha@pHC"
            style={styles.input}
            placeholderTextColor="#9AA8A3"
          />
          {loginError ? <Text style={styles.error}>{loginError}</Text> : null}
          <Pressable onPress={handleLogin} disabled={busy} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.primaryText}>{busy ? "Signing in…" : "Sign in"}</Text>
          </Pressable>
          <Text style={styles.hint}>
            Portal sign-in is independent of the app OAuth flow. Any staff Open ID works for a local deployment.
          </Text>
        </View>
      </View>
    );
  }

  return <PortalBoard facilityId={facilityId} onFacilityId={setFacilityId} onLogout={handleLogout} />;
}

import { useHealth } from "@/lib/health/store";
import { useUserAuth } from "@/lib/health/DoctorAuthContext";

function PortalBoard({
  facilityId,
  onFacilityId,
  onLogout,
}: {
  facilityId: string;
  onFacilityId: (value: string) => void;
  onLogout: () => void;
}) {
  const { state, updateQueueStatus, markVaccineAdministered } = useHealth();
  const { user } = useUserAuth();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const activeHospitalId = facilityId || user?.facilityId || "hosp-nandipur-01";
  const activeHospitalName = user?.facilityName || "Hospital Console";

  const hospitalQueue = useMemo(() => {
    return (state.queue || [])
      .filter((q) => q && q.status !== "completed" && (!activeHospitalId || q.facilityId === activeHospitalId))
      .sort((a, b) => {
        const order: Record<string, number> = { emergency: 0, urgent: 1, priority: 2, routine: 3 };
        const pa = order[a.priority] ?? 4;
        const pb = order[b.priority] ?? 4;
        if (pa !== pb) return pa - pb;
        return (a.arrivedAt || 0) - (b.arrivedAt || 0);
      });
  }, [state.queue, activeHospitalId]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <MaterialIcons name="medical-services" size={26} color="#087E7B" />
          <View>
            <Text style={styles.brandTitle}>Doctor Console · {activeHospitalName}</Text>
            <Text style={styles.hint}>Live synced hospital board for staff & doctors</Text>
          </View>
        </View>
        <View style={styles.topBarRight}>
          <View style={[styles.connPill, { backgroundColor: "#EEF6F0" }]}>
            <View style={[styles.connDot, { backgroundColor: "#198754" }]} />
            <Text style={[styles.connText, { color: "#198754" }]}>Live Hospital Sync</Text>
          </View>
          <Pressable onPress={onLogout} style={styles.linkButton}>
            <Text style={styles.linkText}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Live Patient Queue ({hospitalQueue.length} active)</Text>
      </View>

      {hospitalQueue.length === 0 ? (
        <View style={[styles.card, { alignItems: "center", padding: 32 }]}>
          <MaterialIcons name="check-circle-outline" size={42} color="#087E7B" />
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>No Patients Waiting</Text>
          <Text style={styles.hint}>When an ASHA Worker or Receptionist registers a patient, they will appear here in real-time.</Text>
        </View>
      ) : (
        <View style={styles.board}>
          <View style={[styles.boardHeader, styles.boardRow]}>
            <Text style={[styles.cell, styles.colToken]}>Token</Text>
            <Text style={[styles.cell, styles.colStatus]}>Status</Text>
            <Text style={[styles.cell, styles.colCat]}>Priority</Text>
            <Text style={[styles.cell, styles.colPatient]}>Patient Secrecy</Text>
            <Text style={[styles.cell, styles.colService]}>Complaint / Doctor</Text>
            <Text style={[styles.cell, styles.colActions]}>Action</Text>
          </View>
          {hospitalQueue.map((item, index) => {
            const patientRecord = state.patients.find((p) => p.id === item.patientId);
            const isTakenIn = item.status === "called" || item.status === "consulting";
            const tokenStr = `#${String(item.tokenNumber ?? index + 1).padStart(2, "0")}`;
            const tone = priorityTone[item.priority || "routine"] || priorityTone.routine;
            
            const patientVaccines = state.vaccinationRecords.filter(v => v.patientId === item.patientId);
            const isExpanded = expandedRowId === item.id;

            return (
              <View key={item.id}>
                <View style={[styles.boardRow, styles.boardBody]}>
                <Text style={[styles.cell, styles.colToken, styles.tokenNum]}>{tokenStr}</Text>
                <View style={[styles.cell, styles.colStatus]}>
                  <Text style={styles.statusText}>{statusText[item.status] || item.status}</Text>
                </View>
                <View style={[styles.cell, styles.colCat]}>
                  <View style={[styles.catPill, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.catPillText, { color: tone.fg }]}>{item.priority}</Text>
                  </View>
                </View>
                <View style={[styles.cell, styles.colPatient]}>
                  <Text style={styles.patientCell}>
                    {isTakenIn ? (patientRecord?.name || `Patient ${tokenStr}`) : `Token ${tokenStr} 🔒`}
                  </Text>
                  <Text style={styles.subCell}>
                    {isTakenIn && patientRecord ? `${patientRecord.age}y · ${patientRecord.sex}` : "Confidential"}
                  </Text>
                </View>
                <View style={[styles.cell, styles.colService]}>
                  <Text style={{ color: "#087E7B", fontWeight: "800", fontSize: 13 }}>
                    🩺 {patientRecord?.disease || item.service || "General OPD"}
                  </Text>
                  <Text style={{ color: "#2369A5", fontWeight: "700", fontSize: 11, marginTop: 2 }}>
                    👨‍⚕️ {item.doctorName ? `Assigned: ${item.doctorName}` : "Doctor assignment pending"}
                  </Text>
                </View>
                <View style={[styles.cell, styles.colActions, styles.actionCell]}>
                  {item.status === "waiting" ? (
                    <Pressable
                      onPress={() => updateQueueStatus(item.id, "called")}
                      style={styles.actionButton}
                    >
                      <MaterialIcons name="login" size={16} color="#087E7B" />
                      <Text style={styles.actionText}>Take Patient In</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => updateQueueStatus(item.id, "completed")}
                      style={styles.actionButton}
                    >
                      <MaterialIcons name="check-circle" size={16} color="#198754" />
                      <Text style={{ color: "#198754", fontWeight: "800", fontSize: 12 }}>Mark Seen ✓</Text>
                    </Pressable>
                  )}
                  {isTakenIn && patientVaccines.length > 0 && (
                    <Pressable
                      onPress={() => setExpandedRowId(isExpanded ? null : item.id)}
                      style={styles.actionButton}
                    >
                      <MaterialIcons name={isExpanded ? "expand-less" : "expand-more"} size={16} color="#087E7B" />
                      <Text style={styles.actionText}>{isExpanded ? "Hide Vaccines" : "Vaccines"}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              {isExpanded && patientRecord && patientVaccines.length > 0 && (
                <View style={styles.expandedPanel}>
                  <VaccinationPanel 
                    patient={patientRecord} 
                    vaccines={patientVaccines} 
                    doctorName={user?.name || "Staff user"}
                    onMarkAdministered={(recordId) => markVaccineAdministered(recordId, user?.name || "Staff user")}
                  />
                </View>
              )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function VaccinationPanel({ patient, vaccines, doctorName, onMarkAdministered }: { patient: any, vaccines: VaccinationRecord[], doctorName: string, onMarkAdministered: (id: string) => void }) {
  return (
    <View style={styles.vaccinePanel}>
      <Text style={styles.vaccineHeader}>💉 Vaccination Tracker</Text>
      <Text style={styles.vaccineSub}>
        {patient.name} · {patient.age} years old
      </Text>
      <View style={styles.vaccineList}>
        {VACCINES.map(v => {
          const record = vaccines.find(r => r.vaccineId === v.id);
          if (!record) return null;
          return (
            <View key={v.id} style={styles.vaccineRow}>
              <Pressable
                onPress={() => !record.administered && onMarkAdministered(record.id)}
                disabled={record.administered}
                style={[styles.checkbox, record.administered && styles.checkboxActive]}
              >
                {record.administered ? (
                  <MaterialIcons name="check" size={16} color="#FFFFFF" />
                ) : null}
              </Pressable>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.vaccineName}>{v.label}</Text>
                <Text style={styles.vaccineDesc}>{v.description}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {record.administered ? (
                  <Text style={styles.vaccineGiven}>Given — {new Date(record.administeredAt || 0).toISOString().split('T')[0]}</Text>
                ) : (
                  <Text style={styles.vaccineDue}>Due: {record.dueDate}</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8F5" },
  content: { padding: 22, paddingBottom: 48, maxWidth: 1080, width: "100%", alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  centerTitle: { color: "#18332F", fontSize: 22, fontWeight: "800", marginTop: 8 },
  centerBody: { color: "#54716B", fontSize: 14, textAlign: "center", maxWidth: 400, lineHeight: 20 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  brandTitle: { color: "#18332F", fontSize: 20, fontWeight: "800" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 20, width: "100%", maxWidth: 420, marginTop: 24, shadowColor: "#18332F", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  eyebrow: { color: "#087E7B", fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 16 },
  label: { color: "#4A6560", fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: "#FFFFFF", borderColor: "#D9E4E0", borderRadius: 12, borderWidth: 1, color: "#18332F", fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  error: { color: "#B42318", fontSize: 13, fontWeight: "700", marginBottom: 10 },
  hint: { color: "#6C817C", fontSize: 12, lineHeight: 18, marginTop: 12 },
  primary: { alignItems: "center", backgroundColor: "#087E7B", borderRadius: 13, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 46, paddingHorizontal: 18 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  topBarRight: { alignItems: "center", flexDirection: "row", gap: 14 },
  connPill: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  connDot: { borderRadius: 5, height: 8, width: 8 },
  connText: { fontSize: 12, fontWeight: "800" },
  linkButton: { padding: 4 },
  linkText: { color: "#087E7B", fontSize: 13, fontWeight: "800" },
  facilityRow: { marginBottom: 8 },
  sectionRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 20, marginBottom: 10 },
  sectionTitle: { color: "#18332F", fontSize: 17, fontWeight: "800" },
  count: { color: "#087E7B", fontSize: 13, fontWeight: "800" },
  admitRow: { alignItems: "flex-start", flexDirection: "row", gap: 12, flexWrap: "wrap" },
  patientPicker: { flex: 1, minWidth: 260 },
  chip: { alignItems: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 12, borderColor: "#D9E4E0", borderWidth: 1, flexDirection: "row", gap: 8, padding: 10, width: 168 },
  chipActive: { borderColor: "#087E7B", borderWidth: 2 },
  chipTag: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  chipTagText: { fontSize: 10, fontWeight: "900" },
  chipLabel: { color: "#18332F", fontSize: 13, fontWeight: "800", flexShrink: 1 },
  chipSub: { color: "#6C817C", fontSize: 11 },
  board: { backgroundColor: "#FFFFFF", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E3EBE7" },
  boardRow: { alignItems: "center", flexDirection: "row", paddingHorizontal: 14, paddingVertical: 12 },
  boardHeader: { backgroundColor: "#F0F4F2" },
  boardBody: { borderTopColor: "#E7EEEB", borderTopWidth: 1 },
  cell: { paddingRight: 10 },
  colToken: { width: 36 },
  colStatus: { width: 120 },
  colCat: { width: 110 },
  colPatient: { flex: 1, minWidth: 140 },
  colService: { width: 140 },
  colActions: { width: 200, flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tokenNum: { color: "#6C817C", fontSize: 13, fontWeight: "900" },
  statusText: { color: "#18332F", fontSize: 13, fontWeight: "700" },
  catPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  catPillText: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  patientCell: { color: "#18332F", fontSize: 14, fontWeight: "800" },
  subCell: { color: "#6C817C", fontSize: 11 },
  serviceCell: { color: "#54716B", fontSize: 13 },
  actionCell: { flexDirection: "row" },
  actionButton: { alignItems: "center", flexDirection: "row", gap: 4, padding: 6, backgroundColor: '#F4F7F5', borderRadius: 6, marginRight: 6 },
  actionText: { color: "#18332F", fontSize: 12, fontWeight: "800" },
  expandedPanel: { backgroundColor: '#F9FAF9', padding: 16, borderTopWidth: 1, borderTopColor: '#E7EEEB' },
  vaccinePanel: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#D9E4E0' },
  vaccineHeader: { color: "#18332F", fontSize: 16, fontWeight: "900", marginBottom: 2 },
  vaccineSub: { color: "#6C817C", fontSize: 13, marginBottom: 16 },
  vaccineList: { gap: 12 },
  vaccineRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#D9E4E0', alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: '#198754', borderColor: '#198754' },
  vaccineName: { color: "#18332F", fontSize: 14, fontWeight: "800" },
  vaccineDesc: { color: "#6C817C", fontSize: 12 },
  vaccineGiven: { color: "#198754", fontSize: 13, fontWeight: "700" },
  vaccineDue: { color: "#B66A00", fontSize: 13, fontWeight: "700" },
});

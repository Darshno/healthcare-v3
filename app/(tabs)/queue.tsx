import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { PrimaryButton, PriorityBadge, SyncPill, LiveQueueBanner, commonStyles } from "@/components/health/ui";
import { useHealth } from "@/lib/health/store";
import { sortQueue } from "@/lib/health/workflows";
import { useUserAuth } from "@/lib/health/DoctorAuthContext";

const facilityId = Number(process.env.EXPO_PUBLIC_FACILITY_ID ?? 0);

export default function QueueScreen() {
  const insets = useSafeAreaInsets();
  const { state, t, updateQueueStatus, priorityReasonLabel } = useHealth();
  const { role, user } = useUserAuth();

  // Doctors and chief doctor see full clinical view
  const isClinical = role === "doctor" || role === "chief_doctor";
  const isStaff = isClinical || role === "asha_worker" || role === "receptionist";
  const canRegister = role === "asha_worker" || role === "receptionist";

  const entries = sortQueue(
    (state.queue || []).filter((item) => item && item.status !== "completed")
  );

  const callNext = () => {
    const next = entries.find((entry) => entry.status === "waiting");
    if (next) updateQueueStatus(next.id, "called");
  };

  const topPadding = insets.top > 0 ? insets.top + 8 : 16;

  return (
    <View style={commonStyles.screen}>
      <FlatList
        data={entries}
        keyExtractor={(item, idx) => item?.id || `q-${idx}`}
        contentContainerStyle={[styles.content, { paddingTop: topPadding }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {facilityId > 0 && <LiveQueueBanner facilityId={facilityId} />}
            <Text style={commonStyles.eyebrow}>
              {user?.facilityName || "Live service board"}
            </Text>
            <Text style={commonStyles.title}>{t("queue")}</Text>
            <Text style={[commonStyles.body, { marginTop: 4, marginBottom: 14 }]}>
              Priority triage first, followed by first-in-first-out OPD queue.
            </Text>

            {isStaff && (
              <View style={styles.actionRow}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    label={t("callNext")}
                    icon="campaign"
                    onPress={callNext}
                    disabled={!entries.some((entry) => entry.status === "waiting")}
                  />
                </View>
                {canRegister && (
                  <Pressable
                    onPress={() => router.push("/register" as never)}
                    style={({ pressed }) => [styles.regBtn, { opacity: pressed ? 0.75 : 1 }]}
                  >
                    <MaterialIcons name="person-add" size={18} color="#087E7B" />
                    <Text style={styles.regBtnText}>New Patient</Text>
                  </Pressable>
                )}
              </View>
            )}

            <View style={styles.summary}>
              <MaterialIcons name="groups" size={19} color="#087E7B" />
              <Text style={styles.summaryText}>
                {entries.length} active patient{entries.length === 1 ? "" : "s"} ·{" "}
                {entries.filter((entry) => entry.priority === "emergency" || entry.priority === "urgent").length} high-risk
              </Text>
            </View>
          </>
        }
        renderItem={({ item, index }) => {
          if (!item) return null;
          const patient = (state.patients || []).find((record) => record && record.id === item.patientId);
          const isTakenIn = item.status === "called" || item.status === "consulting";

          // Privacy Secrecy: Display Token + Disease only until doctor takes patient in
          const tokenStr = `#${String(item.tokenNumber ?? index + 1).padStart(2, "0")}`;
          const patientName = isTakenIn
            ? (patient?.name || `Patient ${tokenStr}`)
            : `Token ${tokenStr} (Confidential)`;
          
          const patientDetails = isTakenIn && patient
            ? `${patient.age}y · ${patient.sex} · ${patient.localId}`
            : `🔒 Patient Privacy Preserved · ${item.service || "General OPD"}`;

          const minutes = item.arrivedAt
            ? Math.max(1, Math.round((Date.now() - item.arrivedAt) / 60000))
            : 1;
          const reasonText = item.priorityReason
            ? priorityReasonLabel(item.priorityReason)
            : "Routine care";

          const assignedDoctor = item.doctorName
            ? `👨‍⚕️ ${item.doctorName}`
            : "👨‍⚕️ Doctor assignment pending";

          return (
            <Pressable
              onPress={() => {
                if (patient?.id) {
                  if (isClinical && item.status === "waiting") {
                    updateQueueStatus(item.id, "called");
                  }
                  router.push(`/patient/${patient.id}` as never);
                }
              }}
              style={({ pressed }) => [commonStyles.card, styles.card, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={styles.topRow}>
                <Text style={styles.token}>{tokenStr}</Text>
                <PriorityBadge priority={item.priority || "routine"} compact />
              </View>
              <Text style={styles.name}>{patientName}</Text>
              <Text style={commonStyles.body}>{patientDetails}</Text>
              
              {/* Disease Description Always Shown */}
              <View style={styles.diseaseContainer}>
                <Text style={styles.disease}>🩺 Symptom/Disease: {patient?.disease || "General OPD Walk-in"}</Text>
              </View>

              {/* Matched Doctor Recommendation */}
              <Text style={styles.assignedDoc}>{assignedDoctor}</Text>
              <Text style={styles.reason}>{reasonText}</Text>

              <View style={styles.footer}>
                <View>
                  <Text style={commonStyles.tiny}>
                    {minutes} min waiting · {t(item.status as any) || item.status}
                  </Text>
                  <View style={{ marginTop: 7 }}>
                    <SyncPill state={item.syncState || "synced"} />
                  </View>
                </View>
                {isClinical && (
                  <Pressable
                    onPress={() => updateQueueStatus(item.id, item.status === "waiting" ? "called" : "completed")}
                    style={({ pressed }) => [styles.action, { opacity: pressed ? 0.65 : 1 }]}
                  >
                    <Text style={styles.actionText}>
                      {item.status === "waiting" ? "Take Patient In" : "Mark Seen ✓"}
                    </Text>
                    <MaterialIcons
                      name={item.status === "waiting" ? "login" : "check-circle"}
                      size={17}
                      color="#087E7B"
                    />
                  </Pressable>
                )}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={[commonStyles.card, styles.empty]}>
            <MaterialIcons name="check-circle-outline" size={42} color="#087E7B" />
            <Text style={styles.emptyTitle}>Queue is Clear</Text>
            <Text style={commonStyles.body}>{t("noQueue")}</Text>
            {canRegister && (
              <Pressable
                onPress={() => router.push("/register" as never)}
                style={styles.emptyButton}
              >
                <MaterialIcons name="person-add" size={16} color="#fff" />
                <Text style={styles.emptyButtonText}>Register Patient</Text>
              </Pressable>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  regBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#E6F5F3", borderColor: "#087E7B", borderWidth: 1.5,
    borderRadius: 14, minHeight: 48, paddingHorizontal: 14,
  },
  regBtnText: { color: "#087E7B", fontSize: 13, fontWeight: "800" },
  summary: { alignItems: "center", backgroundColor: "#E6F5F3", borderRadius: 13, flexDirection: "row", gap: 8, marginVertical: 12, padding: 12 },
  summaryText: { color: "#087E7B", fontSize: 13, fontWeight: "800" },
  card: { marginBottom: 2 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  token: { color: "#6C817C", fontSize: 12, fontWeight: "900" },
  name: { color: "#18332F", fontSize: 18, fontWeight: "900", marginTop: 8 },
  diseaseContainer: { backgroundColor: "#E6F5F3", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 6 },
  disease: { color: "#087E7B", fontSize: 12, fontWeight: "800" },
  assignedDoc: { color: "#2369A5", fontSize: 12, fontWeight: "800", marginTop: 6 },
  reason: { color: "#B66A00", fontSize: 12, fontWeight: "800", marginTop: 4 },
  footer: { alignItems: "flex-end", borderTopColor: "#E7EEEB", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 10 },
  action: { alignItems: "center", flexDirection: "row", gap: 5, minHeight: 32 },
  actionText: { color: "#087E7B", fontSize: 12, fontWeight: "900" },
  empty: { alignItems: "center", justifyContent: "center", marginTop: 24, padding: 28, gap: 8 },
  emptyTitle: { color: "#18332F", fontSize: 17, fontWeight: "900", marginTop: 6 },
  emptyButton: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#087E7B", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 12,
  },
  emptyButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});

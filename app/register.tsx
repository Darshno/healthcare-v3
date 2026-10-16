import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
} from "react-native";
import { useHealth } from "@/lib/health/store";
import type { Patient } from "@/lib/health/types";

import { analyzeClinicalTriage, analyzeDiseaseRuleBased } from "@/lib/health/aiTriage";

type Sex = Patient["sex"];

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

const TRIAGE_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  emergency: { bg: "#FDECEC", fg: "#B42318", label: "🚨 Emergency" },
  urgent: { bg: "#FFF4E5", fg: "#9A5B00", label: "⚡ Urgent" },
  priority: { bg: "#EAF4FF", fg: "#2369A5", label: "📋 Priority" },
  routine: { bg: "#EEF6F0", fg: "#198754", label: "✅ Routine" },
};

export default function RegisterPatientScreen() {
  const { registerPatient, createVaccinationSchedule } = useHealth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<Sex>("female");
  const [disease, setDisease] = useState("");
  const [createVaccines, setCreateVaccines] = useState(true);

  const triageContext = age.trim() && Number.isFinite(Number(age)) && Number(age) > 0
    ? { age: Number(age) }
    : undefined;
  const triageAnalysis = disease.trim() ? analyzeDiseaseRuleBased(disease, triageContext) : null;
  const clinicalTriage = disease.trim() ? analyzeClinicalTriage(disease, triageContext) : null;
  const triageLevel = triageAnalysis ? triageAnalysis.priority : "routine";
  const triageColor = TRIAGE_COLORS[triageLevel];
  
  const isInfant = Number(age) > 0 && Number(age) <= 2;

  const save = () => {
    const trimmedName = name.trim();
    const parsedAge = Number(age);

    if (!trimmedName) {
      Alert.alert("Missing Info", "Please enter the patient's name.");
      return;
    }
    if (!age.trim() || Number.isNaN(parsedAge) || parsedAge <= 0 || parsedAge > 130) {
      Alert.alert("Missing Info", "Please enter a valid age.");
      return;
    }

    const patientId = registerPatient({
      name: trimmedName,
      age: parsedAge,
      sex,
      contact: phone.trim() || undefined,
      disease: disease.trim() || undefined,
    });

    if (!patientId) return; // Permission denied (store shows alert)

    if (isInfant && createVaccines) {
      // Create with today as DOB for demo purposes
      createVaccinationSchedule(patientId, new Date());
    }

    // Navigate to queue — never leave a blank screen
    router.replace("/(tabs)/queue" as never);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.55 : 1 }]}
        >
          <MaterialIcons name="arrow-back" size={21} color="#18332F" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.titleRow}>
          <View style={styles.titleIcon}>
            <MaterialIcons name="person-add" size={22} color="#087E7B" />
          </View>
          <View>
            <Text style={styles.eyebrow}>Patient Registration</Text>
            <Text style={styles.title}>Register New Patient</Text>
          </View>
        </View>

        {/* Patient Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Patient Name *</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Meera Devi"
            placeholderTextColor="#8CA19B"
            style={styles.input}
            autoFocus
          />
        </View>

        {/* Phone + Age row */}
        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Optional"
              placeholderTextColor="#8CA19B"
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Age (years) *</Text>
            <TextInput
              value={age}
              onChangeText={setAge}
              placeholder="e.g. 34"
              placeholderTextColor="#8CA19B"
              keyboardType="numeric"
              style={styles.input}
            />
          </View>
        </View>

        {/* Sex */}
        <View style={styles.field}>
          <Text style={styles.label}>Sex *</Text>
          <View style={styles.choiceRow}>
            {SEX_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => setSex(opt.value)}
                style={({ pressed }) => [
                  styles.choice,
                  sex === opt.value && styles.choiceActive,
                  { opacity: pressed ? 0.7 : 1, flex: 1 },
                ]}
              >
                <Text style={[styles.choiceText, sex === opt.value && styles.choiceTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Symptoms / Chief Complaint */}
        <View style={styles.field}>
          <Text style={styles.label}>Symptoms / Chief Complaint</Text>
          <TextInput
            value={disease}
            onChangeText={setDisease}
            placeholder="e.g. fever, chest pain, diabetes follow-up"
            placeholderTextColor="#8CA19B"
            style={[styles.input, styles.textArea]}
            multiline
            numberOfLines={3}
          />
          <Text style={styles.hint}>
            This helps determine triage priority automatically.
          </Text>
        </View>

        {/* Vaccination Toggle for Infants */}
        {isInfant && (
          <View style={[styles.field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 13, borderColor: '#D5E1DD', borderWidth: 1 }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.label}>Create Vaccination Schedule</Text>
              <Text style={[styles.hint, { marginTop: 2 }]}>
                Automatically generates standard 4 injections schedule and schedules offline push notifications.
              </Text>
            </View>
            <Switch 
              value={createVaccines} 
              onValueChange={setCreateVaccines}
              trackColor={{ false: "#D5E1DD", true: "#087E7B" }}
              thumbColor="#FFFFFF"
            />
          </View>
        )}

        {/* Triage Preview */}
        {disease.trim() && triageAnalysis ? (
          <View style={[styles.triagePreview, { backgroundColor: triageColor.bg }]}>
            <MaterialIcons name="health-and-safety" size={22} color={triageColor.fg} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.triageLabel, { color: triageColor.fg }]}>
                Suggested staff priority: {triageColor.label} ({triageAnalysis.recommendedSpecialization})
              </Text>
              <Text style={[styles.triageSub, { color: triageColor.fg }]}>
                {triageAnalysis.clinicalSummary} Clinical review required; this is not a diagnosis.
              </Text>
              {clinicalTriage?.missingInformation.length ? (
                <Text style={[styles.triageSub, { color: triageColor.fg }]}>
                  Follow-up information: {clinicalTriage.missingInformation.join(", ")}.
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.triagePreview, { backgroundColor: TRIAGE_COLORS.routine.bg }]}>
            <MaterialIcons name="info-outline" size={18} color={TRIAGE_COLORS.routine.fg} />
            <Text style={[styles.triageLabel, { color: TRIAGE_COLORS.routine.fg }]}>
              Triage not assessed — no symptoms entered.
            </Text>
          </View>
        )}

        {/* Submit */}
        <Pressable
          onPress={save}
          style={({ pressed }) => [styles.submitBtn, { opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
        >
          <MaterialIcons name="add-circle" size={20} color="#fff" />
          <Text style={styles.submitText}>Add Patient to Queue</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7F5" },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16, alignSelf: "flex-start", minHeight: 32 },
  backText: { color: "#18332F", fontSize: 14, fontWeight: "800" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  titleIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#E6F5F3", alignItems: "center", justifyContent: "center" },
  eyebrow: { color: "#087E7B", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { color: "#18332F", fontSize: 20, fontWeight: "900" },
  field: { marginTop: 14 },
  label: { color: "#18332F", fontSize: 13, fontWeight: "800", marginBottom: 7 },
  input: {
    backgroundColor: "#FFFFFF", borderColor: "#D5E1DD", borderRadius: 13,
    borderWidth: 1, color: "#18332F", fontSize: 16, minHeight: 50, paddingHorizontal: 14,
  },
  textArea: { minHeight: 80, paddingTop: 12, textAlignVertical: "top" },
  hint: { color: "#6C817C", fontSize: 11, fontWeight: "600", marginTop: 5 },
  row: { flexDirection: "row", gap: 12 },
  flex: { flex: 1 },
  choiceRow: { flexDirection: "row", gap: 8 },
  choice: {
    backgroundColor: "#FFFFFF", borderColor: "#D5E1DD", borderRadius: 999,
    borderWidth: 1, minHeight: 40, paddingHorizontal: 12, justifyContent: "center", alignItems: "center",
  },
  choiceActive: { backgroundColor: "#E6F5F3", borderColor: "#087E7B" },
  choiceText: { color: "#54716B", fontSize: 14, fontWeight: "700" },
  choiceTextActive: { color: "#087E7B", fontWeight: "900" },
  triagePreview: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 13, padding: 12, marginTop: 10,
  },
  triageLabel: { fontSize: 13, fontWeight: "800" },
  triageSub: { fontSize: 11, fontWeight: "600", marginTop: 2, opacity: 0.8 },
  submitBtn: {
    alignItems: "center", backgroundColor: "#087E7B", borderRadius: 14,
    flexDirection: "row", gap: 10, justifyContent: "center",
    minHeight: 54, marginTop: 22, paddingHorizontal: 18,
  },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
});

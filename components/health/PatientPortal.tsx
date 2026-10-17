import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState, useMemo } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHealth } from "@/lib/health/store";
import { useUserAuth } from "@/lib/health/DoctorAuthContext";
import type {
  HospitalFacility,
  HospitalDoctor,
  Medicine,
  Patient,
} from "@/lib/health/types";

type PatientPortalTab = "queue" | "records" | "appointments" | "medicines";

const EMERGENCY_SYMPTOMS = [
  "Severe Chest Pain / Pressure",
  "Sudden Severe Breathing Difficulty",
  "Heavy Acute Bleeding / Trauma",
  "High Fever with Convulsions (Child Danger)",
  "Unconsciousness / Severe Dizziness",
  "Labour Pain / Obstetric Emergency",
];

export function PatientPortal() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useUserAuth();
  const {
    state,
    joinQueue,
    bookAppointment,
    cancelAppointment,
    requestEmergencyAppointment,
    orderMedicine,
    getPatientAppointments,
    getPatientOrders,
    getPatientEncounters,
  } = useHealth();

  const [activeTab, setActiveTab] = useState<PatientPortalTab>("queue");

  // Determine current active patient from user profile or fallback to first patient
  const activePatient: Patient = useMemo(() => {
    const customPatientId = (user as any)?.patientId;
    if (customPatientId) {
      const found = state.patients.find((p) => p.id === customPatientId);
      if (found) return found;
    }
    return (
      state.patients.find((p) => p.name.toLowerCase() === (user?.name || "").toLowerCase()) ||
      state.patients[0]
    );
  }, [state.patients, user]);

  // Active Queue Entry for this patient
  const patientQueue = useMemo(() => {
    return state.queue.find(
      (q) => q.patientId === activePatient.id && q.status !== "completed",
    );
  }, [state.queue, activePatient.id]);

  // Position in queue
  const queuePosition = useMemo(() => {
    if (!patientQueue) return 0;
    const activeWaiting = state.queue.filter(
      (q) => (q.status === "waiting" || q.status === "called") && q.id !== patientQueue.id,
    );
    return activeWaiting.length;
  }, [state.queue, patientQueue]);

  // Patient data
  const encounters = useMemo(() => getPatientEncounters(activePatient.id), [getPatientEncounters, activePatient.id]);
  const appointments = useMemo(() => getPatientAppointments(activePatient.id), [getPatientAppointments, activePatient.id]);
  const orders = useMemo(() => getPatientOrders(activePatient.id), [getPatientOrders, activePatient.id]);

  // ─── Modal States ───
  const [showJoinQueueModal, setShowJoinQueueModal] = useState(false);
  const [queueService, setQueueService] = useState("General OPD Consultation");

  const [showBookModal, setShowBookModal] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState<HospitalFacility>(state.hospitals[0] || {} as any);
  const [selectedDoctor, setSelectedDoctor] = useState<HospitalDoctor | null>(null);
  const [appointmentDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split("T")[0],
  );
  const [appointmentSlot, setAppointmentSlot] = useState("10:30 AM");
  const [appointmentReason, setAppointmentReason] = useState("");

  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [emergencyNotes, setEmergencyNotes] = useState("");

  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [orderQuantity, setOrderQuantity] = useState("30");
  const [fulfillmentType, setFulfillmentType] = useState<"pickup_phc" | "asha_home_delivery">("pickup_phc");
  const [orderNotes, setOrderNotes] = useState("");
  const [medicineSearch, setMedicineSearch] = useState("");


  // ─── Handlers ───

  const handleJoinQueue = () => {
    joinQueue({
      patientId: activePatient.id,
      service: queueService,
      priority: activePatient.careTags.includes("maternal") ? "urgent" : "routine",
      priorityReason: activePatient.careTags.includes("maternal") ? "vitalConcern" : "routineCare",
    });
    setShowJoinQueueModal(false);
  };

  const handleBookAppointment = () => {
    if (!selectedDoctor) {
      Alert.alert("Doctor Required", "Please select a doctor to book an appointment.");
      return;
    }
    bookAppointment({
      patientId: activePatient.id,
      patientName: activePatient.name,
      patientPhone: activePatient.contact,
      facilityId: selectedHospital.id,
      facilityName: selectedHospital.name,
      doctorId: selectedDoctor.id,
      doctorName: selectedDoctor.name,
      specialty: selectedDoctor.specialization,
      date: appointmentDate,
      timeSlot: appointmentSlot,
      reason: appointmentReason.trim() || "General health consultation",
    });
    setShowBookModal(false);
    setAppointmentReason("");
  };

  const handleEmergencySOS = () => {
    if (selectedSymptoms.length === 0 && !emergencyNotes.trim()) {
      Alert.alert("Symptoms Required", "Please select at least one symptom or describe your condition.");
      return;
    }
    requestEmergencyAppointment({
      patientId: activePatient.id,
      patientName: activePatient.name,
      patientPhone: activePatient.contact,
      facilityId: selectedHospital.id || "hosp-1",
      facilityName: selectedHospital.name || "Nandipur Primary Health Centre",
      reason: emergencyNotes.trim() || "Acute Emergency Consultation Request",
      symptoms: selectedSymptoms,
      severity: "critical",
    });
    setShowEmergencyModal(false);
    setSelectedSymptoms([]);
    setEmergencyNotes("");
    setActiveTab("queue");
  };

  const handleOrderMedicine = () => {
    if (!selectedMedicine) return;
    const qty = parseInt(orderQuantity, 10) || 10;
    orderMedicine({
      patientId: activePatient.id,
      patientName: activePatient.name,
      patientPhone: activePatient.contact,
      facilityName: selectedHospital.name || "Nandipur Primary Health Centre",
      items: [
        {
          medicineId: selectedMedicine.id,
          medicineName: selectedMedicine.name,
          quantity: qty,
          unit: selectedMedicine.unit,
        },
      ],
      fulfillmentType,
      notes: orderNotes.trim() || undefined,
    });
    setShowOrderModal(false);
    setSelectedMedicine(null);
    setOrderNotes("");
  };

  // Filter medicines
  const filteredMedicines = useMemo(() => {
    const q = medicineSearch.toLowerCase().trim();
    if (!q) return state.medicines;
    return state.medicines.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.localName.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q),
    );
  }, [state.medicines, medicineSearch]);

  return (
    <View style={styles.container}>
      {/* Top Patient Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerProfileRow}>
          <View style={styles.patientAvatar}>
            <Text style={styles.patientAvatarText}>
              {activePatient.name.slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <Text style={styles.patientName}>{activePatient.name}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Patient</Text>
              </View>
            </View>
            <Text style={styles.patientSub}>
              Health ID: {activePatient.abhaId || "ABHA-9820-1124"} · Ref: {activePatient.localId}
            </Text>
          </View>
          <Pressable
            onPress={signOut}
            style={styles.signOutBtn}
            accessibilityLabel="Switch profile / Sign out"
          >
            <MaterialIcons name="logout" size={18} color="#6C817C" />
          </Pressable>
        </View>

        {/* Emergency SOS Banner Shortcut */}
        <Pressable
          onPress={() => setShowEmergencyModal(true)}
          style={styles.emergencySosBar}
        >
          <View style={styles.sosDot} />
          <MaterialIcons name="emergency" size={20} color="#FFFFFF" />
          <Text style={styles.emergencySosText}>REQUEST EMERGENCY ASSISTANCE / SOS</Text>
          <MaterialIcons name="chevron-right" size={20} color="#FFFFFF" />
        </Pressable>


      </View>

      {/* Main Content Area */}
<ScrollView
  contentContainerStyle={[
    styles.contentScroll,
    { paddingBottom: insets.bottom + 24 }
  ]}
  showsVerticalScrollIndicator={false}
>

        {/* ─── TAB 1: Live Queue Tracker ─── */}
        {activeTab === "queue" && (
          <View style={styles.tabContent}>
            {patientQueue ? (
              <View style={styles.liveQueueCard}>
                <View style={styles.liveQueueTop}>
                  <View style={styles.livePulseDot} />
                  <Text style={styles.liveQueueTitle}>LIVE OPD TOKEN TRACKER</Text>
                  <View style={[styles.statusPill, { backgroundColor: patientQueue.status === "called" ? "#FDECEC" : "#E6F5F3" }]}>
                    <Text style={[styles.statusPillText, { color: patientQueue.status === "called" ? "#B42318" : "#087E7B" }]}>
                      {patientQueue.status === "called" ? "🔔 NOW CALLING" : patientQueue.status === "consulting" ? "🩺 IN CONSULTATION" : "⏳ WAITING IN QUEUE"}
                    </Text>
                  </View>
                </View>

                {/* Big Token Display */}
                <View style={styles.tokenBox}>
                  <Text style={styles.tokenLabel}>YOUR TOKEN NUMBER</Text>
                  <Text style={styles.tokenNumber}>#{patientQueue.tokenNumber || 102}</Text>
                  <Text style={styles.tokenService}>{patientQueue.service}</Text>
                </View>

                {/* Live Stats Row */}
                <View style={styles.queueStatsRow}>
                  <View style={styles.queueStatItem}>
                    <Text style={styles.queueStatValue}>
                      {patientQueue.status === "called" ? "0" : queuePosition}
                    </Text>
                    <Text style={styles.queueStatLabel}>Patients Ahead</Text>
                  </View>
                  <View style={styles.queueStatDivider} />
                  <View style={styles.queueStatItem}>
                    <Text style={styles.queueStatValue}>
                      {patientQueue.status === "called" ? "Now" : `~${Math.max(5, queuePosition * 8)} mins`}
                    </Text>
                    <Text style={styles.queueStatLabel}>Est. Wait Time</Text>
                  </View>
                  <View style={styles.queueStatDivider} />
                  <View style={styles.queueStatItem}>
                    <Text style={styles.queueStatValue}>{patientQueue.roomNumber || "Room 2"}</Text>
                    <Text style={styles.queueStatLabel}>Consultation Room</Text>
                  </View>
                </View>

                {/* Assigned Doctor Banner */}
                {patientQueue.doctorName && (
                  <View style={styles.doctorRosterBanner}>
                    <MaterialIcons name="person" size={20} color="#087E7B" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.doctorRosterTitle}>Assigned Physician: {patientQueue.doctorName}</Text>
                      <Text style={styles.doctorRosterSub}>Please proceed to {patientQueue.roomNumber || "OPD Counter"} when your token is announced.</Text>
                    </View>
                  </View>
                )}

                {/* Live Progress Milestones */}
                <View style={styles.milestonesContainer}>
                  <Text style={styles.milestonesTitle}>VISIT PROGRESS</Text>
                  <View style={styles.milestoneRow}>
                    <View style={[styles.milestoneDot, styles.milestoneDotComplete]} />
                    <Text style={styles.milestoneText}>1. Registered & Triage</Text>
                  </View>
                  <View style={styles.milestoneLine} />
                  <View style={styles.milestoneRow}>
                    <View style={[styles.milestoneDot, patientQueue.status !== "waiting" ? styles.milestoneDotComplete : styles.milestoneDotActive]} />
                    <Text style={styles.milestoneText}>2. OPD Queue Waiting</Text>
                  </View>
                  <View style={styles.milestoneLine} />
                  <View style={styles.milestoneRow}>
                    <View style={[styles.milestoneDot, patientQueue.status === "called" || patientQueue.status === "consulting" ? styles.milestoneDotActive : styles.milestoneDotPending]} />
                    <Text style={styles.milestoneText}>3. Doctor Consultation</Text>
                  </View>
                  <View style={styles.milestoneLine} />
                  <View style={styles.milestoneRow}>
                    <View style={[styles.milestoneDot, patientQueue.status === "pharmacy" ? styles.milestoneDotActive : styles.milestoneDotPending]} />
                    <Text style={styles.milestoneText}>4. Pharmacy Dispensation</Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.emptyQueueCard}>
                <View style={styles.emptyQueueIcon}>
                  <MaterialIcons name="confirmation-number" size={40} color="#087E7B" />
                </View>
                <Text style={styles.emptyQueueTitle}>You are not currently in the OPD Queue</Text>
                <Text style={styles.emptyQueueSub}>
                  Join the queue to receive an instant digital token number and live queue waiting status at your Primary Health Centre.
                </Text>
                <Pressable
                  onPress={() => setShowJoinQueueModal(true)}
                  style={styles.joinQueueBtn}
                >
                  <MaterialIcons name="add-circle-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.joinQueueBtnText}>Join Live OPD Queue</Text>
                </Pressable>
              </View>
            )}

            {/* Simple actions with one clear choice per row */}
            <Text style={styles.sectionHeader}>What would you like to do?</Text>
            <View style={styles.actionsGrid}>
              <Pressable
                onPress={() => { setActiveTab("appointments"); setShowBookModal(true); }}
                style={styles.actionCard}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: "#E6F5F3" }]}>
                  <MaterialIcons name="calendar-today" size={24} color="#087E7B" />
                </View>
                <Text style={styles.actionTitle}>Book a doctor visit</Text>
                <Text style={styles.actionSub}>Choose a hospital and time</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab("medicines")}
                style={styles.actionCard}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: "#F5EEFF" }]}>
                  <MaterialIcons name="medication" size={24} color="#7B4F9A" />
                </View>
                <Text style={styles.actionTitle}>Order medicines</Text>
                <Text style={styles.actionSub}>Request a refill</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab("records")}
                style={styles.actionCard}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: "#FFF4E5" }]}>
                  <MaterialIcons name="folder-shared" size={24} color="#B66A00" />
                </View>
                <Text style={styles.actionTitle}>See my health records</Text>
                <Text style={styles.actionSub}>Medicines, allergies, and visits</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ─── TAB 2: Patient Health Records & History ─── */}
        {activeTab === "records" && (
          <View style={styles.tabContent}>
            {/* Digital ABHA Health Card */}
            <View style={styles.digitalHealthCard}>
              <View style={styles.cardTopRow}>
                <View style={styles.govSymbol}>
                  <MaterialIcons name="security" size={22} color="#087E7B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardGovTitle}>NATIONAL DIGITAL HEALTH MISSION</Text>
                  <Text style={styles.cardGovSub}>ABHA Citizen Health Record</Text>
                </View>
                <View style={styles.qrPlaceholder}>
                  <MaterialIcons name="qr-code-2" size={32} color="#18332F" />
                </View>
              </View>

              <View style={styles.cardPatientDetails}>
                <Text style={styles.cardPatientName}>{activePatient.name}</Text>
                <Text style={styles.cardAbhaNumber}>{activePatient.abhaId || "ABHA-9820-1124-9011"}</Text>

                <View style={styles.cardInfoGrid}>
                  <View style={styles.cardInfoCol}>
                    <Text style={styles.cardInfoLabel}>GENDER / AGE</Text>
                    <Text style={styles.cardInfoVal}>{activePatient.sex.toUpperCase()} / {activePatient.age} YRS</Text>
                  </View>
                  <View style={styles.cardInfoCol}>
                    <Text style={styles.cardInfoLabel}>BLOOD GROUP</Text>
                    <Text style={styles.cardInfoVal}>{activePatient.bloodGroup || "B+"}</Text>
                  </View>
                  <View style={styles.cardInfoCol}>
                    <Text style={styles.cardInfoLabel}>PRIMARY PHC</Text>
                    <Text style={styles.cardInfoVal}>Nandipur PHC</Text>
                  </View>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <MaterialIcons name="verified" size={16} color="#087E7B" />
                <Text style={styles.cardFooterText}>Ayushman Bharat Health Account (Verified)</Text>
              </View>
            </View>

            {/* Medical Summary Cards */}
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>KNOWN ALLERGIES</Text>
                <View style={styles.tagsRow}>
                  {activePatient.allergies.map((allergy, i) => (
                    <View key={i} style={[styles.tagBadge, { backgroundColor: "#FDECEC" }]}>
                      <Text style={[styles.tagBadgeText, { color: "#B42318" }]}>{allergy}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>ACTIVE MEDICINES</Text>
                <View style={styles.tagsRow}>
                  {activePatient.currentMedicines.length > 0 ? (
                    activePatient.currentMedicines.map((med, i) => (
                      <View key={i} style={[styles.tagBadge, { backgroundColor: "#E6F5F3" }]}>
                        <Text style={[styles.tagBadgeText, { color: "#087E7B" }]}>{med}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.noDataText}>No active chronic medicines</Text>
                  )}
                </View>
              </View>
            </View>

            {/* Past Consultations Timeline */}
            <Text style={styles.sectionHeader}>CONSULTATION & ENCOUNTERS HISTORY</Text>
            {encounters.length > 0 ? (
              encounters.map((enc) => (
                <View key={enc.id} style={styles.encounterCard}>
                  <View style={styles.encounterHeader}>
                    <View style={styles.encounterTypeBadge}>
                      <Text style={styles.encounterTypeText}>{enc.type.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.encounterDate}>
                      {new Date(enc.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </Text>
                  </View>

                  {enc.doctorName && (
                    <Text style={styles.encounterDoctor}>Attending: {enc.doctorName}</Text>
                  )}

                  {enc.diagnosis && (
                    <View style={styles.diagnosisBox}>
                      <Text style={styles.diagnosisLabel}>DIAGNOSIS:</Text>
                      <Text style={styles.diagnosisText}>{enc.diagnosis}</Text>
                    </View>
                  )}

                  <Text style={styles.encounterNote}>{enc.note}</Text>

                  {enc.prescriptions && enc.prescriptions.length > 0 && (
                    <View style={styles.prescriptionsBox}>
                      <Text style={styles.prescriptionsLabel}>Rx Prescribed:</Text>
                      {enc.prescriptions.map((rx, idx) => (
                        <Text key={idx} style={styles.prescriptionItem}>• {rx}</Text>
                      ))}
                    </View>
                  )}
                </View>
              ))
            ) : (
              <Text style={styles.noDataText}>No past consultation history recorded yet.</Text>
            )}
          </View>
        )}

        {/* ─── TAB 3: Appointments & Emergency ─── */}
        {activeTab === "appointments" && (
          <View style={styles.tabContent}>
            <View style={styles.appointmentActionRow}>
              <Pressable
                onPress={() => setShowBookModal(true)}
                style={styles.bookAptBtn}
              >
                <MaterialIcons name="add" size={20} color="#FFFFFF" />
                <Text style={styles.bookAptBtnText}>Book New Appointment</Text>
              </Pressable>

              <Pressable
                onPress={() => setShowEmergencyModal(true)}
                style={styles.emergencyAptBtn}
              >
                <MaterialIcons name="emergency" size={20} color="#FFFFFF" />
                <Text style={styles.emergencyAptBtnText}>Emergency SOS</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionHeader}>MY APPOINTMENTS</Text>
            {appointments.length > 0 ? (
              appointments.map((apt) => (
                <View key={apt.id} style={[styles.aptCard, apt.isEmergency && styles.aptCardEmergency]}>
                  <View style={styles.aptHeader}>
                    <View style={[styles.aptBadge, { backgroundColor: apt.isEmergency ? "#FDECEC" : "#E6F5F3" }]}>
                      <Text style={[styles.aptBadgeText, { color: apt.isEmergency ? "#B42318" : "#087E7B" }]}>
                        {apt.isEmergency ? "🚨 EMERGENCY SOS" : "SCHEDULED APPOINTMENT"}
                      </Text>
                    </View>
                    <Text style={styles.aptStatus}>Status: {apt.status.toUpperCase()}</Text>
                  </View>

                  <Text style={styles.aptDoctorName}>{apt.doctorName}</Text>
                  <Text style={styles.aptSpecialty}>{apt.specialty} · {apt.facilityName}</Text>

                  <View style={styles.aptTimeRow}>
                    <MaterialIcons name="event" size={16} color="#54716B" />
                    <Text style={styles.aptTimeText}>{apt.date} at {apt.timeSlot}</Text>
                  </View>

                  <Text style={styles.aptReason}>Reason: {apt.reason}</Text>

                  {apt.status === "confirmed" && (
                    <Pressable
                      onPress={() => cancelAppointment(apt.id)}
                      style={styles.cancelAptBtn}
                    >
                      <Text style={styles.cancelAptBtnText}>Cancel Booking</Text>
                    </Pressable>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>No appointments booked currently.</Text>
              </View>
            )}
          </View>
        )}


        {/* ─── TAB 4: Medicine Stocks & Ordering ─── */}
        {activeTab === "medicines" && (
          <View style={styles.tabContent}>
            {/* Search Input */}
            <View style={styles.searchBar}>
              <MaterialIcons name="search" size={20} color="#8CA19B" />
              <TextInput
                value={medicineSearch}
                onChangeText={setMedicineSearch}
                placeholder="Search essential medicines (e.g. ORS, Amlodipine, Iron)..."
                placeholderTextColor="#8CA19B"
                style={styles.searchInput}
              />
            </View>

            {/* My Active Medicine Orders */}
            {orders.length > 0 && (
              <View style={styles.ordersSection}>
                <Text style={styles.sectionHeader}>MY MEDICINE REFILL ORDERS ({orders.length})</Text>
                {orders.map((ord) => (
                  <View key={ord.id} style={styles.orderCard}>
                    <View style={styles.orderHeader}>
                      <Text style={styles.orderFacility}>{ord.facilityName}</Text>
                      <View style={[styles.orderStatusPill, { backgroundColor: ord.status === "ready_for_pickup" ? "#E6F5F3" : "#FFF4E5" }]}>
                        <Text style={[styles.orderStatusText, { color: ord.status === "ready_for_pickup" ? "#087E7B" : "#B66A00" }]}>
                          {ord.status.replace(/_/g, " ").toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    {ord.items.map((item, idx) => (
                      <Text key={idx} style={styles.orderItemText}>• {item.medicineName} x {item.quantity} {item.unit}</Text>
                    ))}
                    <Text style={styles.orderFulfillment}>
                      Fulfillment: {ord.fulfillmentType === "asha_home_delivery" ? "🏡 ASHA Village Delivery" : "🏥 PHC Pharmacy Counter Pickup"}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Essential Medicine Stock Directory */}
            <Text style={styles.sectionHeader}>PHC PHARMACY LIVE STOCKS</Text>
            {filteredMedicines.map((med) => {
              const inStock = med.stock > 0;
              const isLow = med.stock > 0 && med.stock <= med.minimumStock;
              return (
                <View key={med.id} style={styles.medicineCard}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.medTitleRow}>
                      <Text style={styles.medicineName}>{med.name}</Text>
                      {med.isGovtSupply && (
                        <View style={styles.govtBadge}>
                          <Text style={styles.govtBadgeText}>Govt Free Supply</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.medLocalName}>{med.localName}</Text>
                    <View style={styles.medStockRow}>
                      <View style={[styles.stockDot, { backgroundColor: inStock ? (isLow ? "#B66A00" : "#12A875") : "#B42318" }]} />
                      <Text style={[styles.stockText, { color: inStock ? (isLow ? "#B66A00" : "#087E7B") : "#B42318" }]}>
                        {inStock ? `${med.stock} ${med.unit} available ${isLow ? "(Low Stock)" : ""}` : "Out of Stock"}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => {
                      setSelectedMedicine(med);
                      setShowOrderModal(true);
                    }}
                    style={[styles.orderMedBtn, !inStock && { opacity: 0.5 }]}
                  >
                    <Text style={styles.orderMedBtnText}>Order Refill</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
</ScrollView>

{/* ─── FIXED BOTTOM NAVIGATION ─── */}
<View
  style={[
    styles.bottomNav,
    { paddingBottom: Math.max(insets.bottom, 8) }
  ]}
>
  {(
    [
      { id: "queue", label: "Live Queue", icon: "confirmation-number" },
      { id: "records", label: "Health Records", icon: "badge" },
      { id: "appointments", label: "Appointments", icon: "event" },
      { id: "medicines", label: "Medicine Stock", icon: "medication" },
    ] as const
  ).map((tab) => {
    const active = activeTab === tab.id;

    return (
      <Pressable
        key={tab.id}
        onPress={() => setActiveTab(tab.id)}
        style={styles.bottomNavItem}
      >
        <MaterialIcons
          name={tab.icon}
          size={22}
          color={active ? "#087E7B" : "#6C817C"}
        />

        <Text
          style={[
            styles.bottomNavText,
            active && styles.bottomNavTextActive,
          ]}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  })}
</View>

{/* ─── MODAL 1: Join Queue ─── */}
<Modal visible={showJoinQueueModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Join Live OPD Queue</Text>
              <Pressable onPress={() => setShowJoinQueueModal(false)}>
                <MaterialIcons name="close" size={24} color="#54716B" />
              </Pressable>
            </View>

            <Text style={styles.modalSub}>Select consultation service for today&apos;s visit:</Text>

            {["General OPD Consultation", "Maternal & Antenatal Care", "Child Health & Immunization", "Chronic Care & BP/Sugar"].map((srv) => (
              <Pressable
                key={srv}
                onPress={() => setQueueService(srv)}
                style={[styles.modalOptionBtn, queueService === srv && styles.modalOptionBtnActive]}
              >
                <MaterialIcons
                  name={queueService === srv ? "radio-button-checked" : "radio-button-unchecked"}
                  size={20}
                  color={queueService === srv ? "#087E7B" : "#8CA19B"}
                />
                <Text style={[styles.modalOptionText, queueService === srv && styles.modalOptionTextActive]}>{srv}</Text>
              </Pressable>
            ))}

            <Pressable onPress={handleJoinQueue} style={styles.modalPrimaryBtn}>
              <Text style={styles.modalPrimaryBtnText}>Generate Queue Token</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ─── MODAL 2: Book Appointment ─── */}
      <Modal visible={showBookModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Book Doctor Appointment</Text>
              <Pressable onPress={() => setShowBookModal(false)}>
                <MaterialIcons name="close" size={24} color="#54716B" />
              </Pressable>
            </View>

            <Text style={styles.modalSub}>Select hospital & doctor:</Text>

            {/* Hospital Picker */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>HOSPITAL / PHC</Text>
              {state.hospitals.map((hosp) => (
                <Pressable
                  key={hosp.id}
                  onPress={() => {
                    setSelectedHospital(hosp);
                    setSelectedDoctor(hosp.doctors[0] || null);
                  }}
                  style={[styles.modalOptionBtn, selectedHospital.id === hosp.id && styles.modalOptionBtnActive]}
                >
                  <Text style={[styles.modalOptionText, selectedHospital.id === hosp.id && styles.modalOptionTextActive]}>
                    {hosp.name} ({hosp.distanceKm} km)
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Doctor Picker */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>SELECT DOCTOR</Text>
              {selectedHospital.doctors?.map((doc) => (
                <Pressable
                  key={doc.id}
                  onPress={() => setSelectedDoctor(doc)}
                  style={[styles.modalOptionBtn, selectedDoctor?.id === doc.id && styles.modalOptionBtnActive]}
                >
                  <Text style={[styles.modalOptionText, selectedDoctor?.id === doc.id && styles.modalOptionTextActive]}>
                    {doc.name} · {doc.specialization}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Time Slot Picker */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>PREFERRED TIME SLOT</Text>
              <View style={styles.slotsRow}>
                {["09:30 AM", "10:30 AM", "11:30 AM", "02:30 PM", "03:30 PM"].map((slot) => (
                  <Pressable
                    key={slot}
                    onPress={() => setAppointmentSlot(slot)}
                    style={[styles.slotBtn, appointmentSlot === slot && styles.slotBtnActive]}
                  >
                    <Text style={[styles.slotBtnText, appointmentSlot === slot && styles.slotBtnTextActive]}>{slot}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Reason */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>REASON FOR VISIT</Text>
              <TextInput
                value={appointmentReason}
                onChangeText={setAppointmentReason}
                placeholder="e.g. Fever, persistent cough, regular pregnancy checkup..."
                placeholderTextColor="#8CA19B"
                style={styles.modalInput}
              />
            </View>

            <Pressable onPress={handleBookAppointment} style={styles.modalPrimaryBtn}>
              <Text style={styles.modalPrimaryBtnText}>Confirm Booking</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ─── MODAL 3: Emergency SOS ─── */}
      <Modal visible={showEmergencyModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={[styles.modalContainer, { borderColor: "#F7C3C0", borderWidth: 2 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialIcons name="emergency" size={26} color="#B42318" />
                <Text style={[styles.modalTitle, { color: "#B42318" }]}>Emergency SOS Request</Text>
              </View>
              <Pressable onPress={() => setShowEmergencyModal(false)}>
                <MaterialIcons name="close" size={24} color="#54716B" />
              </Pressable>
            </View>

            <Text style={styles.modalSub}>
              Select active emergency symptoms for immediate triage escalation:
            </Text>

            {EMERGENCY_SYMPTOMS.map((sym) => {
              const selected = selectedSymptoms.includes(sym);
              return (
                <Pressable
                  key={sym}
                  onPress={() => {
                    setSelectedSymptoms((prev) =>
                      selected ? prev.filter((s) => s !== sym) : [...prev, sym],
                    );
                  }}
                  style={[styles.emergencySymptomBtn, selected && styles.emergencySymptomBtnSelected]}
                >
                  <MaterialIcons
                    name={selected ? "check-box" : "check-box-outline-blank"}
                    size={20}
                    color={selected ? "#B42318" : "#8CA19B"}
                  />
                  <Text style={[styles.emergencySymptomText, selected && styles.emergencySymptomTextSelected]}>{sym}</Text>
                </Pressable>
              );
            })}

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>ADDITIONAL NOTES</Text>
              <TextInput
                value={emergencyNotes}
                onChangeText={setEmergencyNotes}
                placeholder="Describe current condition or location details..."
                placeholderTextColor="#8CA19B"
                style={styles.modalInput}
              />
            </View>

            <Pressable onPress={handleEmergencySOS} style={[styles.modalPrimaryBtn, { backgroundColor: "#B42318" }]}>
              <MaterialIcons name="warning" size={20} color="#FFFFFF" />
              <Text style={styles.modalPrimaryBtnText}>DISPATCH EMERGENCY ALERT NOW</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ─── MODAL 4: Order Medicine ─── */}
      <Modal visible={showOrderModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Order Medicine Refill</Text>
              <Pressable onPress={() => setShowOrderModal(false)}>
                <MaterialIcons name="close" size={24} color="#54716B" />
              </Pressable>
            </View>

            {selectedMedicine && (
              <View style={styles.orderSummaryBox}>
                <Text style={styles.orderSummaryName}>{selectedMedicine.name}</Text>
                <Text style={styles.orderSummarySub}>{selectedMedicine.localName} · In Stock: {selectedMedicine.stock} {selectedMedicine.unit}</Text>
              </View>
            )}

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>QUANTITY NEEDED</Text>
              <TextInput
                value={orderQuantity}
                onChangeText={setOrderQuantity}
                placeholder="30"
                keyboardType="number-pad"
                placeholderTextColor="#8CA19B"
                style={styles.modalInput}
              />
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>FULFILLMENT PREFERENCE</Text>
              <Pressable
                onPress={() => setFulfillmentType("pickup_phc")}
                style={[styles.modalOptionBtn, fulfillmentType === "pickup_phc" && styles.modalOptionBtnActive]}
              >
                <Text style={[styles.modalOptionText, fulfillmentType === "pickup_phc" && styles.modalOptionTextActive]}>
                  🏥 Counter Pickup at PHC Pharmacy
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFulfillmentType("asha_home_delivery")}
                style={[styles.modalOptionBtn, fulfillmentType === "asha_home_delivery" && styles.modalOptionBtnActive]}
              >
                <Text style={[styles.modalOptionText, fulfillmentType === "asha_home_delivery" && styles.modalOptionTextActive]}>
                  🏡 ASHA Health Worker Village Delivery
                </Text>
              </Pressable>
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>PRESCRIPTION NOTES / DOCTOR ADVICE</Text>
              <TextInput
                value={orderNotes}
                onChangeText={setOrderNotes}
                placeholder="e.g. As advised by Dr. Asha for monthly hypertension control"
                placeholderTextColor="#8CA19B"
                style={styles.modalInput}
              />
            </View>

            <Pressable onPress={handleOrderMedicine} style={styles.modalPrimaryBtn}>
              <Text style={styles.modalPrimaryBtnText}>Place Refill Order</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,

  minHeight: 88,

  backgroundColor: "#FFFFFF",

  borderTopWidth: 1,
  borderTopColor: "#D5E1DD",

  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-around",

  paddingHorizontal: 8,

  ...Platform.select({
    web: {
      boxShadow: "0 -2px 8px rgba(0,0,0,0.08)",
    } as any,
    default: {
      elevation: 8,
    },
  }),
},

bottomNavItem: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: 10,
  gap: 3,
},

bottomNavText: {
  fontSize: 12,
  fontWeight: "700",
  color: "#6C817C",
  textAlign: "center",
},

bottomNavTextActive: {
  color: "#087E7B",
  fontWeight: "900",
},
  container: {
    flex: 1,
    backgroundColor: "#F4F8F6",
  },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2ECE8",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  patientAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1B6B93",
    alignItems: "center",
    justifyContent: "center",
  },
  patientAvatarText: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "900",
    color: "#18332F",
  },
  roleBadge: {
    backgroundColor: "#E9F4F9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#BBE1F2",
  },
  roleBadgeText: {
    color: "#1B6B93",
    fontSize: 10,
    fontWeight: "900",
  },
  patientSub: {
    fontSize: 14,
    color: "#6C817C",
    marginTop: 2,
  },
  signOutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F2F6F4",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D5E1DD",
  },
  emergencySosBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#B42318",
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  sosDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  emergencySosText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  tabBar: {
    flexDirection: "row",
  },
  tabItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F2F6F4",
    marginRight: 8,
  },
  tabItemActive: {
    backgroundColor: "#E6F5F3",
    borderWidth: 1,
    borderColor: "#087E7B",
  },
  tabItemText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6C817C",
  },
  tabItemTextActive: {
    color: "#087E7B",
    fontWeight: "900",
  },
  contentScroll: {
    padding: 20,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  tabContent: {
    gap: 14,
  },
  liveQueueCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2ECE8",
    ...Platform.select({
      web: { boxShadow: "0 2px 8px rgba(0,0,0,0.04)" } as any,
      default: { elevation: 2 },
    }),
  },
  liveQueueTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  livePulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#12A875",
  },
  liveQueueTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#18332F",
    flex: 1,
    letterSpacing: 0.5,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillText: {
    fontSize: 14,
    fontWeight: "900",
  },
  tokenBox: {
    alignItems: "center",
    backgroundColor: "#F4FAF8",
    borderRadius: 14,
    paddingVertical: 18,
    borderWidth: 1.5,
    borderColor: "#BEE6E2",
    marginBottom: 14,
  },
  tokenLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#087E7B",
    letterSpacing: 0.6,
  },
  tokenNumber: {
    fontSize: 48,
    fontWeight: "900",
    color: "#18332F",
    marginVertical: 4,
  },
  tokenService: {
    fontSize: 16,
    fontWeight: "700",
    color: "#54716B",
  },
  queueStatsRow: {
    flexDirection: "row",
    backgroundColor: "#F9FBFB",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E4EDE9",
    marginBottom: 14,
  },
  queueStatItem: {
    flex: 1,
    alignItems: "center",
  },
  queueStatValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#18332F",
  },
  queueStatLabel: {
    fontSize: 13,
    color: "#6C817C",
    marginTop: 2,
  },
  queueStatDivider: {
    width: 1,
    backgroundColor: "#D5E1DD",
  },
  doctorRosterBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#E6F5F3",
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  doctorRosterTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#087E7B",
  },
  doctorRosterSub: {
    fontSize: 11,
    color: "#54716B",
    marginTop: 1,
  },
  milestonesContainer: {
    borderTopWidth: 1,
    borderTopColor: "#E4EDE9",
    paddingTop: 12,
  },
  milestonesTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C817C",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  milestoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  milestoneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  milestoneDotComplete: {
    backgroundColor: "#12A875",
  },
  milestoneDotActive: {
    backgroundColor: "#087E7B",
  },
  milestoneDotPending: {
    backgroundColor: "#D5E1DD",
  },
  milestoneLine: {
    width: 2,
    height: 12,
    backgroundColor: "#D5E1DD",
    marginLeft: 4,
    marginVertical: 2,
  },
  milestoneText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#18332F",
  },
  emptyQueueCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  emptyQueueIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#E6F5F3",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyQueueTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#18332F",
    marginBottom: 6,
    textAlign: "center",
  },
  emptyQueueSub: {
    fontSize: 16,
    color: "#54716B",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 18,
  },
  joinQueueBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#087E7B",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  joinQueueBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "900",
    color: "#6C817C",
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 6,
  },
  actionsGrid: {
    gap: 12,
  },
  actionCard: {
    flex: 1,
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    minHeight: 84,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  actionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  actionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#18332F",
  },
  actionSub: {
    fontSize: 14,
    color: "#6C817C",
    marginTop: 2,
  },
  digitalHealthCard: {
    backgroundColor: "#18332F",
    borderRadius: 16,
    padding: 18,
    color: "#FFFFFF",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  govSymbol: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  cardGovTitle: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  cardGovSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
  },
  qrPlaceholder: {
    backgroundColor: "#FFFFFF",
    padding: 4,
    borderRadius: 8,
  },
  cardPatientDetails: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
    paddingTop: 12,
  },
  cardPatientName: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  cardAbhaNumber: {
    color: "#087E7B",
    fontSize: 13,
    fontWeight: "900",
    backgroundColor: "#E6F5F3",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    marginBottom: 12,
  },
  cardInfoGrid: {
    flexDirection: "row",
    gap: 12,
  },
  cardInfoCol: {
    flex: 1,
  },
  cardInfoLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 9,
    fontWeight: "800",
  },
  cardInfoVal: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: 8,
  },
  cardFooterText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "700",
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  summaryTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: "#6C817C",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  noDataText: {
    fontSize: 12,
    color: "#8CA19B",
  },
  encounterCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  encounterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  encounterTypeBadge: {
    backgroundColor: "#E6F5F3",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  encounterTypeText: {
    color: "#087E7B",
    fontSize: 10,
    fontWeight: "900",
  },
  encounterDate: {
    fontSize: 11,
    color: "#6C817C",
    fontWeight: "700",
  },
  encounterDoctor: {
    fontSize: 13,
    fontWeight: "800",
    color: "#18332F",
    marginBottom: 6,
  },
  diagnosisBox: {
    backgroundColor: "#F2F7F5",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  diagnosisLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#087E7B",
  },
  diagnosisText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#18332F",
    marginTop: 2,
  },
  encounterNote: {
    fontSize: 12,
    color: "#54716B",
    lineHeight: 18,
  },
  prescriptionsBox: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E4EDE9",
    paddingTop: 8,
  },
  prescriptionsLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C817C",
    marginBottom: 4,
  },
  prescriptionItem: {
    fontSize: 11,
    color: "#18332F",
    fontWeight: "700",
    lineHeight: 16,
  },
  appointmentActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  bookAptBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#087E7B",
    paddingVertical: 12,
    borderRadius: 12,
  },
  bookAptBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  emergencyAptBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#B42318",
    paddingVertical: 12,
    borderRadius: 12,
  },
  emergencyAptBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  aptCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  aptCardEmergency: {
    borderColor: "#F7C3C0",
    borderWidth: 1.5,
  },
  aptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  aptBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  aptBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  aptStatus: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C817C",
  },
  aptDoctorName: {
    fontSize: 15,
    fontWeight: "900",
    color: "#18332F",
  },
  aptSpecialty: {
    fontSize: 12,
    color: "#54716B",
    marginTop: 2,
    marginBottom: 8,
  },
  aptTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F4F7F5",
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  aptTimeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#18332F",
  },
  aptReason: {
    fontSize: 12,
    color: "#54716B",
    lineHeight: 18,
  },
  cancelAptBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#FDECEC",
  },
  cancelAptBtnText: {
    color: "#B42318",
    fontSize: 11,
    fontWeight: "800",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  emptyCardText: {
    color: "#6C817C",
    fontSize: 13,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D5E1DD",
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: "#18332F",
  },
  hospitalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  hospitalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  hospitalName: {
    fontSize: 16,
    fontWeight: "900",
    color: "#18332F",
  },
  hospitalType: {
    fontSize: 12,
    color: "#087E7B",
    fontWeight: "700",
    marginTop: 1,
  },
  hospitalAddress: {
    fontSize: 11,
    color: "#6C817C",
    marginTop: 2,
  },
  bedBadge: {
    backgroundColor: "#E6F5F3",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#BEE6E2",
  },
  bedBadgeNumber: {
    fontSize: 16,
    fontWeight: "900",
    color: "#087E7B",
  },
  bedBadgeLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#087E7B",
  },
  facilitiesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  facilityPill: {
    backgroundColor: "#F2F6F4",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  facilityPillText: {
    fontSize: 10,
    color: "#54716B",
    fontWeight: "700",
  },
  doctorRosterHeader: {
    fontSize: 10,
    fontWeight: "900",
    color: "#6C817C",
    letterSpacing: 0.5,
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: "#E4EDE9",
    paddingTop: 10,
  },
  doctorsList: {
    gap: 8,
  },
  doctorItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F9FBFB",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E4EDE9",
  },
  docAvatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#087E7B",
    alignItems: "center",
    justifyContent: "center",
  },
  docAvatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  docNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  docName: {
    fontSize: 13,
    fontWeight: "900",
    color: "#18332F",
  },
  availBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  availBadgeText: {
    fontSize: 9,
    fontWeight: "800",
  },
  docSpec: {
    fontSize: 11,
    color: "#087E7B",
    fontWeight: "700",
  },
  docTimings: {
    fontSize: 10,
    color: "#6C817C",
    marginTop: 1,
  },
  bookDocBtn: {
    backgroundColor: "#087E7B",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  bookDocBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  hospContactBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F2F7F5",
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  hospPhoneText: {
    fontSize: 11,
    color: "#18332F",
    fontWeight: "700",
  },
  hospSosText: {
    fontSize: 11,
    color: "#B42318",
    fontWeight: "900",
  },
  ordersSection: {
    marginBottom: 8,
  },
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2ECE8",
    marginBottom: 8,
  },
  orderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  orderFacility: {
    fontSize: 13,
    fontWeight: "800",
    color: "#18332F",
  },
  orderStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  orderStatusText: {
    fontSize: 10,
    fontWeight: "900",
  },
  orderItemText: {
    fontSize: 12,
    color: "#18332F",
    fontWeight: "700",
  },
  orderFulfillment: {
    fontSize: 11,
    color: "#54716B",
    marginTop: 4,
  },
  medicineCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2ECE8",
  },
  medTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  medicineName: {
    fontSize: 14,
    fontWeight: "900",
    color: "#18332F",
  },
  govtBadge: {
    backgroundColor: "#E6F5F3",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  govtBadgeText: {
    color: "#087E7B",
    fontSize: 9,
    fontWeight: "800",
  },
  medLocalName: {
    fontSize: 12,
    color: "#6C817C",
    marginTop: 1,
  },
  medStockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  stockDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  stockText: {
    fontSize: 11,
    fontWeight: "700",
  },
  orderMedBtn: {
    backgroundColor: "#087E7B",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  orderMedBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "85%",
    maxWidth: 600,
    width: "100%",
    alignSelf: "center",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#18332F",
  },
  modalSub: {
    fontSize: 12,
    color: "#54716B",
    marginBottom: 14,
  },
  modalSection: {
    marginBottom: 12,
  },
  modalSectionTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C817C",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  modalOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F4F7F5",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE7E3",
    marginBottom: 8,
  },
  modalOptionBtnActive: {
    backgroundColor: "#E6F5F3",
    borderColor: "#087E7B",
  },
  modalOptionText: {
    fontSize: 13,
    color: "#54716B",
    fontWeight: "700",
  },
  modalOptionTextActive: {
    color: "#087E7B",
    fontWeight: "900",
  },
  slotsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  slotBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F2F6F4",
    borderWidth: 1,
    borderColor: "#D5E1DD",
  },
  slotBtnActive: {
    backgroundColor: "#087E7B",
    borderColor: "#087E7B",
  },
  slotBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#54716B",
  },
  slotBtnTextActive: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  modalInput: {
    backgroundColor: "#F7FAF9",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D5E1DD",
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: "#18332F",
  },
  modalPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#087E7B",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  modalPrimaryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  emergencySymptomBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF5F5",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F7D0CE",
    marginBottom: 8,
  },
  emergencySymptomBtnSelected: {
    backgroundColor: "#FDECEC",
    borderColor: "#B42318",
  },
  emergencySymptomText: {
    fontSize: 13,
    color: "#54716B",
    fontWeight: "700",
  },
  emergencySymptomTextSelected: {
    color: "#B42318",
    fontWeight: "900",
  },
  orderSummaryBox: {
    backgroundColor: "#E6F5F3",
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  orderSummaryName: {
    fontSize: 15,
    fontWeight: "900",
    color: "#087E7B",
  },
  orderSummarySub: {
    fontSize: 12,
    color: "#54716B",
    marginTop: 2,
  },
});

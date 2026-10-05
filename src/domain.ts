export type Client = {
  id: string;
  auth_user_id?: string | null;
  name: string;
  email: string;
  phone: string;
  marketing_email?: boolean;
  marketing_sms?: boolean;
  marketing_whatsapp?: boolean;
  revision: number;
  created_at?: string;
  updated_at?: string;
};
export type Staff = {
  id: number;
  name: string;
  active?: boolean;
  photo_url?: string | null;
};
export type Appointment = {
  id: string;
  user_id?: string | null;
  client_id?: string | null;
  treatment_id?: number;
  booked_for_self?: boolean;
  attendee_email?: string;
  phone?: string;
  staff_id: number;
  start_minute: number;
  duration: number;
  client_name: string;
  treatment_name: string;
  price: number;
  status: string;
  payment_method?: string;
  appointment_date: string;
  revision?: number;
};
export type DiaryBreak = {
  id: string | null;
  staff_id: number;
  appointment_date?: string;
  start_minute: number;
  duration: number;
  kind: string;
  revision: number;
};
export type Note = {
  id: string;
  client_id: string;
  body: string;
  author_name: string;
  created_at: string;
};
export type Activity = {
  id: string | number;
  client_id?: string | null;
  appointment_id?: string;
  action: string;
  created_at: string;
  actor_name: string;
  details?: Record<string, any> | null;
};
export type LocalStaffData = {
  staffRecords?: StaffRecord[];
  staffNotes?: StaffNote[];
  dayShifts?: DayShift[];
  clients: Client[];
  notes: Note[];
  activity: Activity[];
  breaks: DiaryBreak[];
  vouchers?: Voucher[];
  voucherTransactions?: VoucherTransaction[];
  shifts?: WorkSession[];
};
export type Voucher = {
  id: string;
  code: string;
  original_amount: number;
  expires_on: string;
  client_id: string | null;
  assigned_client_name: string | null;
  revision: number;
  created_at: string;
  balance?: number;
  recipient_email?: string;
  demo_purchase?: boolean;
  purchased_by?: string;
  treatment_name?: string | null;
};
export type VoucherTransaction = {
  id: string;
  voucher_id: string;
  kind: string;
  amount: number;
  from_client_id?: string | null;
  to_client_id?: string | null;
  actor_name: string;
  created_at: string;
};
export type WorkSession = {
  id: string;
  user_id: string;
  staff_id: number;
  staff_name: string;
  clocked_in_at: string;
  clocked_out_at: string | null;
  revision?: number;
  correction_reason?: string;
};

export type StaffRecord = Staff & {
  staff_id: number;
  first_name: string;
  last_name: string;
  address: string;
  date_of_birth: string | null;
  phone: string;
  email: string;
  date_hired: string | null;
  date_left: string | null;
  employment_type: string;
  salary: number | null;
  hourly_rate: number | null;
  commission_rate: number | null;
  revision: number;
  role: string;
  profile_key?: string;
  pin_set?: boolean;
  demo_pin?: string;
  treatment_ids?: number[];
};
export type StaffNote = {
  id: string;
  staff_id: number;
  body: string;
  created_at: string;
  removed_at?: string | null;
};
export type DayShift = {
  staff_id: number;
  shift_date: string;
  start_minute: number | null;
  end_minute: number | null;
  revision: number;
};

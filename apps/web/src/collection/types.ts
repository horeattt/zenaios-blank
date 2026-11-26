export type Me = {
  displayName: string;
  hospitalId: string;
  passwordChangeRequired: boolean;
  permissions: string[];
  wardScopeIds: string[] | null;
  hospitalWideAccess: boolean;
};

export type WardBoardRow = {
  id: string;
  name: string;
  specialty: string | null;
  bed_total: number;
  bed_open: number;
  occupied: number;
  free: number;
};

export type BedBoardRow = {
  bed_id: string;
  label: string;
  status: string;
  room_id: string;
  room_name: string;
  admission_id: string | null;
  patient_id: string | null;
  first_name: string | null;
  last_name: string | null;
  sex: string | null;
  started_at: string | null;
};

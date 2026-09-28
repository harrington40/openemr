/** Insurance company record */
export interface InsuranceCompany {
  id: string;
  uuid: string;
  name: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/** Procedure record */
export interface Procedure {
  uuid: string;
  name?: string;
  code?: string;
  code_text?: string;
  amount?: string;
}

/** Drug record */
export interface Drug {
  uuid: string;
  name: string;
  code?: string;
  price?: string;
  quantity?: string;
  manufacturer?: string;
}

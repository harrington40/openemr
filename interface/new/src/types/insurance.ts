/** Insurance record from the OpenEMR API */
export interface Insurance {
  uuid: string;
  puuid?: string;
  type: string;
  plan_name?: string;
  provider_name?: string;
  policy_number?: string;
  group_number?: string;
  subscriber_fname?: string;
  subscriber_lname?: string;
  subscriber_relationship?: string;
  subscriber_dob?: string;
  subscriber_ss?: string;
  subscriber_phone?: string;
  subscriber_address?: string;
  subscriber_city?: string;
  subscriber_state?: string;
  subscriber_zip?: string;
  copay?: string;
  deductible?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  date_added?: string;
}

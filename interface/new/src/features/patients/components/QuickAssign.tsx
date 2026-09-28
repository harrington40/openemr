import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { toDateInput } from '../../../utils/date';

interface Props {
  patientId: string;
  currentProviderId?: string;
  currentProviderName?: string;
}

export default function QuickAssign({ patientId, currentProviderId, currentProviderName }: Props) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [justAssignedId, setJustAssignedId] = useState<string | null>(null);

  const { data: availableProviders = [], isLoading } = useQuery({
    queryKey: ['providers-available-today'],
    queryFn: async () => { const r = await nestClient.get('/providers/available-today'); return r.data; },
  });

  // Fallback: all active providers when none are scheduled
  const { data: allProviders = [] } = useQuery({
    queryKey: ['providers-list'],
    queryFn: async () => { const r = await nestClient.get('/admin/users'); return r.data; },
    enabled: showAll || !availableProviders.length,
  });

  const assignMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const today = toDateInput(new Date());
      const now = new Date().toTimeString().substring(0, 5);
      // 1. Assign provider
      await nestClient.patch(`/patients/${patientId}`, { providerID: providerId });
      // 2. Create walk-in check-in for flow board
      await nestClient.post(`/patients/${patientId}/walk-in`, { providerId: parseInt(providerId) });
      // 3. Create a same-day appointment so patient is scheduled
      await nestClient.post(`/patients/${patientId}/appointments`, {
        pc_catid: 5,
        pc_title: 'Walk-In Visit',
        pc_duration: 30,
        pc_hometext: 'Quick assigned',
        pc_apptstatus: 'Checked In',
        pc_eventDate: today,
        pc_startTime: now,
        pc_facility: 0,
        pc_billing_location: 0,
        pc_aid: providerId,
      });
    },
    onSuccess: (_data: any, providerId: string) => {
      setJustAssignedId(providerId);
      // Prefix invalidation: the patient object and every chart sub-resource
      // refresh, so an assignment shows up without a manual reload.
      queryClient.invalidateQueries({ queryKey: ['patient'] });
      queryClient.invalidateQueries({ queryKey: ['providers-available-today'] });
      queryClient.invalidateQueries({ queryKey: ['providers-list'] });
      queryClient.invalidateQueries({ queryKey: ['appointments', 'flow'] });
    },
  });

  const providers = availableProviders.length > 0 ? availableProviders : (showAll ? allProviders.filter((p: any) => p.active) : []);

  if (isLoading) {
    return (
      <div className="card mb-3">
        <div className="card-header py-2">
          <h6 className="mb-0"><i className="bi bi-person-check me-2"></i>Quick Assign</h6>
        </div>
        <div className="card-body text-center py-2">
          <div className="spinner-border spinner-border-sm text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-3 border-primary">
      <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center py-2">
        <h6 className="mb-0">
          <i className="bi bi-person-check me-2"></i>
          Quick Assign {availableProviders.length > 0 ? '— Available Today' : ''}
        </h6>
        <span className="badge bg-light text-primary">
          {availableProviders.length > 0 ? `${availableProviders.length} available` : 'Manual'}
        </span>
      </div>
      <div className="card-body p-2">
        {currentProviderId && currentProviderName && (
          <div className="alert alert-success py-2 mb-2 small">
            <i className="bi bi-check-circle me-1"></i>
            Currently assigned to: <strong>{currentProviderName}</strong>
          </div>
        )}

        {availableProviders.length === 0 && !showAll && (
          <div className="text-center py-2">
            <div className="text-muted small mb-2">
              <i className="bi bi-calendar-x me-1"></i>
              No providers with office hours scheduled today
            </div>
            <button className="btn btn-outline-primary btn-sm" onClick={() => setShowAll(true)}>
              <i className="bi bi-list-ul me-1"></i>Show All Providers (Manual Assign)
            </button>
          </div>
        )}

        {providers.length > 0 && (
          <div className="list-group list-group-flush">
            {showAll && availableProviders.length === 0 && (
              <div className="text-muted small px-2 py-1 bg-warning bg-opacity-10 rounded mb-1">
                <i className="bi bi-info-circle me-1"></i>
                Manual assignment mode — showing all active providers
              </div>
            )}
            {providers.map((p: any) => {
              const isAssigned = String(p.id) === String(currentProviderId) || String(p.id) === justAssignedId;
              const isScheduled = !!p.first_available;
              return (
                <div
                  key={p.id}
                  className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-2 ${isAssigned ? 'active' : ''}`}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="rounded-circle d-inline-block"
                      style={{
                        width: '10px', height: '10px',
                        backgroundColor: p.calendar_color || '#0d6efd',
                      }}
                    ></span>
                    <div>
                      <div className="fw-semibold small">
                        {p.title ? `${p.title} ` : ''}{p.fname} {p.lname}
                        {!isScheduled && (
                          <span className="badge bg-secondary ms-1" style={{ fontSize: '0.65rem' }}>Manual</span>
                        )}
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {p.specialty && <span>{p.specialty}</span>}
                        {isScheduled && (
                          <span> · {p.first_available?.substring(0, 5)}–{p.last_available?.substring(0, 5)}</span>
                        )}
                        {p.appointment_count > 0 && (
                          <span> · {p.appointment_count} appt{p.appointment_count !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className={`btn btn-sm ${isAssigned ? 'btn-light' : 'btn-outline-primary'}`}
                    onClick={() => assignMutation.mutate(String(p.id))}
                    disabled={isAssigned || assignMutation.isPending}
                  >
                    {isAssigned ? (
                      <><i className="bi bi-check2 me-1"></i>Assigned</>
                    ) : assignMutation.isPending ? (
                      <><span className="spinner-border spinner-border-sm me-1"></span>Assigning...</>
                    ) : (
                      <><i className="bi bi-person-plus me-1"></i>Assign</>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

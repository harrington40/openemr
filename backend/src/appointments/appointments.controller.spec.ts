import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppointmentsController } from './appointments.controller';

/**
 * Route declaration order.
 *
 * Express matches in registration order, so a literal path declared *after* a
 * parameterised one is unreachable — the parameter swallows it. That is what hid
 * `GET appointments/walk-ins` behind `GET appointments/:eid`: `eid` became the
 * string 'walk-ins', `parseInt` turned it into NaN, mysql2 interpolated it as the
 * bare token `NaN`, and MySQL answered `Unknown column 'NaN' in 'WHERE'`. The flow
 * board's walk-in column just stayed empty, because the query error was swallowed
 * by a `= []` default. Nothing in the types catches this, so it is asserted here.
 */
describe('AppointmentsController route order', () => {
  const routes = Object.getOwnPropertyNames(AppointmentsController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name, index) => {
      const handler = (AppointmentsController.prototype as Record<string, unknown>)[name];
      return {
        index,
        name,
        path: Reflect.getMetadata(PATH_METADATA, handler as object) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, handler as object) as RequestMethod | undefined,
      };
    })
    .filter((route) => route.path !== undefined) as {
      index: number;
      name: string;
      path: string;
      method: RequestMethod;
    }[];

  const segments = (path: string) => path.split('/').filter(Boolean);
  const isParam = (segment: string) => segment.startsWith(':');

  it('found the decorated handlers (guards against a silent no-op test)', () => {
    expect(routes.length).toBeGreaterThan(6);
    expect(routes.some((r) => r.path === 'appointments/walk-ins')).toBe(true);
    expect(routes.some((r) => r.path === 'appointments/:eid')).toBe(true);
  });

  it('declares appointments/walk-ins before the parameterised appointments/:eid', () => {
    const walkIns = routes.find((r) => r.path === 'appointments/walk-ins')!;
    const byId = routes.find((r) => r.path === 'appointments/:eid')!;

    expect(walkIns.method).toBe(RequestMethod.GET);
    expect(byId.method).toBe(RequestMethod.GET);
    expect(walkIns.index).toBeLessThan(byId.index);
  });

  it('never declares a literal path after an earlier route that would shadow it', () => {
    const literalRoutes = routes.filter((route) => !segments(route.path).some(isParam));

    const shadowing = literalRoutes.flatMap((route) => {
      const routeSegments = segments(route.path);
      return routes
        .filter(
          (other) =>
            other.index < route.index &&
            other.method === route.method &&
            segments(other.path).length === routeSegments.length &&
            segments(other.path).every(
              (segment, i) => isParam(segment) || segment === routeSegments[i],
            ),
        )
        .map((other) => `${other.path} is declared before ${route.path} and swallows it`);
    });

    expect(shadowing).toEqual([]);
  });
});

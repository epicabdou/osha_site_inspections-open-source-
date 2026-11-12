import 'server-only';
import type { Template } from '@/lib/schemas';

/**
 * Demo checklists, written from scratch in plain language for this project.
 * They are illustrative only: not copied from any standard, vendor or product,
 * and not a substitute for an inspection by a competent person.
 */
export const SEED_TEMPLATES: Template[] = [
  {
    id: 'scaffold-inspection',
    version: 1,
    title: 'Scaffold pre-use inspection',
    sections: [
      {
        id: 'access-and-tag',
        title: 'Access and tag',
        items: [
          {
            id: 'tag-in-date',
            prompt: 'A tag at the access point shows the scaffold was checked and is safe to use',
            kind: 'pass_fail_na',
            critical: true,
            photoOnFail: true,
            guidance: 'Look for a dated tag signed by the person who last inspected the scaffold.',
          },
          {
            id: 'safe-way-up',
            prompt: 'There is a safe way up: a secured ladder or a stair tower',
            kind: 'pass_fail_na',
          },
          {
            id: 'access-gate',
            prompt: 'The opening at the top of the ladder is closed by a gate or rail',
            kind: 'pass_fail_na',
          },
        ],
      },
      {
        id: 'base-and-frame',
        title: 'Base and frame',
        items: [
          {
            id: 'base-plates',
            prompt: 'Every upright stands on a base plate and board on firm, level ground',
            kind: 'pass_fail_na',
            critical: true,
            photoOnFail: true,
          },
          {
            id: 'ties-and-braces',
            prompt: 'No ties, braces or clamps are missing, loose or bent',
            kind: 'pass_fail_na',
          },
          {
            id: 'upright-and-level',
            prompt: 'Uprights look vertical and the horizontal tubes look level',
            kind: 'pass_fail_na',
          },
        ],
      },
      {
        id: 'platform-and-edges',
        title: 'Platform and edges',
        items: [
          {
            id: 'guardrail-height',
            prompt: 'Height of the top guardrail above the platform',
            kind: 'number',
            unit: 'mm',
            min: 950,
            max: 1150,
            critical: true,
            photoOnFail: true,
            guidance: 'Measure from the platform surface to the top of the rail.',
          },
          {
            id: 'boards-complete',
            prompt: 'Platform boards are complete and secure, with no gaps to trip on',
            kind: 'pass_fail_na',
          },
          {
            id: 'toe-boards',
            prompt: 'Toe boards run along every open edge',
            kind: 'pass_fail_na',
          },
          {
            id: 'weather',
            prompt: 'Weather at the time of the check (wind, rain, ice)',
            kind: 'text',
          },
          {
            id: 'overview-photo',
            prompt: 'Photo of the whole scaffold from the access point',
            kind: 'photo',
          },
          {
            id: 'other-notes',
            prompt: 'Anything else you noticed',
            kind: 'text',
          },
        ],
      },
    ],
  },
  {
    id: 'fire-safety',
    version: 1,
    title: 'Fire safety and emergency preparedness',
    sections: [
      {
        id: 'escape-routes',
        title: 'Escape routes',
        items: [
          {
            id: 'exits-clear',
            prompt: 'Escape routes and exit doors are clear of stored goods and rubbish',
            kind: 'pass_fail_na',
            critical: true,
            photoOnFail: true,
          },
          {
            id: 'exit-signs',
            prompt: 'Exit signs are lit and can be seen from the routes',
            kind: 'pass_fail_na',
          },
          {
            id: 'exit-doors-open',
            prompt: 'Exit doors open easily from the inside without a key',
            kind: 'pass_fail_na',
          },
          {
            id: 'fire-doors-close',
            prompt: 'Fire doors close fully by themselves and are not propped open',
            kind: 'pass_fail_na',
            critical: true,
            photoOnFail: true,
          },
        ],
      },
      {
        id: 'alarm-and-equipment',
        title: 'Alarm and equipment',
        items: [
          {
            id: 'alarm-test',
            prompt: 'The fire alarm sounded throughout the area in its latest test',
            kind: 'pass_fail_na',
            critical: true,
          },
          {
            id: 'extinguishers-present',
            prompt: 'Extinguishers are in their marked places and their seals are intact',
            kind: 'pass_fail_na',
          },
          {
            id: 'emergency-lighting-duration',
            prompt: 'How long the emergency lights stayed on during the battery test',
            kind: 'number',
            unit: 'min',
            min: 180,
            guidance: 'Read the duration from the test log or the panel.',
          },
        ],
      },
      {
        id: 'housekeeping',
        title: 'Housekeeping',
        items: [
          {
            id: 'waste-stored',
            prompt: 'Burnable waste is kept away from heaters, lights and sparks',
            kind: 'pass_fail_na',
          },
          {
            id: 'hot-work-permit',
            prompt: 'Any welding or cutting in progress has a current permit',
            kind: 'pass_fail_na',
          },
          {
            id: 'last-drill',
            prompt: 'When the last evacuation drill took place, and how it went',
            kind: 'text',
          },
          {
            id: 'route-photo',
            prompt: 'Photo of the main escape route',
            kind: 'photo',
          },
        ],
      },
    ],
  },
  {
    id: 'general-workplace',
    version: 1,
    title: 'General workplace inspection',
    sections: [
      {
        id: 'floors-and-light',
        title: 'Floors and lighting',
        items: [
          {
            id: 'walkways-clear',
            prompt: 'Walkways are marked and free of trip hazards',
            kind: 'pass_fail_na',
          },
          {
            id: 'spills',
            prompt: 'No spills or slippery patches on the floor',
            kind: 'pass_fail_na',
          },
          {
            id: 'bench-light-level',
            prompt: 'Light level measured at the main workbench',
            kind: 'number',
            unit: 'lux',
            min: 300,
            max: 2000,
          },
        ],
      },
      {
        id: 'machines-and-power',
        title: 'Machines and power',
        items: [
          {
            id: 'guards-in-place',
            prompt: 'Guards on moving machine parts are fitted and working',
            kind: 'pass_fail_na',
            critical: true,
            photoOnFail: true,
          },
          {
            id: 'cables-undamaged',
            prompt: 'Power cables, plugs and sockets show no damage or exposed wires',
            kind: 'pass_fail_na',
            critical: true,
            photoOnFail: true,
          },
          {
            id: 'isolation-labelled',
            prompt: 'Isolation switches are labelled and easy to reach',
            kind: 'pass_fail_na',
          },
        ],
      },
      {
        id: 'welfare-and-people',
        title: 'Welfare and people',
        items: [
          {
            id: 'first-aid-stocked',
            prompt: 'The first aid kit is stocked and in date',
            kind: 'pass_fail_na',
          },
          {
            id: 'eyewash',
            prompt: 'The eyewash station is clean and its water is fresh',
            kind: 'pass_fail_na',
          },
          {
            id: 'ppe-worn',
            prompt: 'People are wearing the protective equipment the task needs',
            kind: 'pass_fail_na',
          },
          {
            id: 'area-photo',
            prompt: 'Photo of the work area',
            kind: 'photo',
          },
          {
            id: 'actions-noted',
            prompt: 'Actions agreed on the spot, and who will do them',
            kind: 'text',
          },
        ],
      },
    ],
  },
];

/** Sites suggested on the device before the inspector has used any. */
export const SEED_SITES = ['Warehouse A', 'Plant room B2', 'Loading dock'] as const;

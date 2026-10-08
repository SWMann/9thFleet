"use client";

import { useState } from "react";
import type { Service } from "@/lib/member";
import type { Band, Grade } from "@/lib/ranks";

const services: { key: Service; name: string; about: string; opensAtStage: number }[] = [
  { key: "navy", name: "Navy", about: "The lead service: ships, turrets, engineering and flight.", opensAtStage: 1 },
  { key: "army", name: "Army", about: "The ground force.", opensAtStage: 4 },
  { key: "marines", name: "Marines", about: "Boarding and ship security.", opensAtStage: 5 },
];

// Leaders among the enlisted grades are enlisted too, so the two are shown as one band.
const bands: { name: string; holds: Band[] }[] = [
  { name: "Enlisted", holds: ["enlisted", "nco"] },
  { name: "Cadet", holds: ["cadet"] },
  { name: "Officers", holds: ["officer"] },
];

/** The ladder of ranks for one service at a time, with a switch between the three. */
export function Ladder({ grades, stage, openServices }: { grades: Grade[]; stage: number; openServices: Service[] }) {
  const [chosen, setChosen] = useState<Service>("navy");
  const service = services.find((item) => item.key === chosen) ?? services[0];
  const serviceOpen = openServices.includes(service.key);

  return (
    <>
      <div className="ladder-bar">
        <div className="tabs" role="group" aria-label="Service">
          {services.map((item) => (
            <button
              key={item.key}
              className="tab"
              type="button"
              aria-pressed={item.key === chosen}
              onClick={() => setChosen(item.key)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <p className="ladder-note">
          {service.about} {serviceOpen ? "Open now." : `Opens at stage ${service.opensAtStage}.`}
        </p>
      </div>

      {bands.map((band) => {
        const inBand = grades.filter((grade) => band.holds.includes(grade.band));
        if (inBand.length === 0) return null;
        const first = inBand[0].code;
        const last = inBand[inBand.length - 1].code;
        return (
          <div className="rank-band" key={band.name}>
            <div className="rank-band-head">
              <h3>{band.name}</h3>
              <p>{first === last ? first : `${first} to ${last}`}</p>
            </div>
            <ul className="ranks">
              {inBand.map((grade) => {
                const open = serviceOpen && grade.opensAtStage <= stage;
                return (
                  <li className={open ? "rank" : "rank rank-later"} key={grade.code}>
                    <span className="rank-code" aria-hidden="true">
                      {grade.code}
                    </span>
                    <div>
                      <h4>{grade.names[service.key]}</h4>
                      <p>
                        <span className="visually-hidden">{grade.code}. </span>
                        {grade.typicalPosition}
                      </p>
                      {serviceOpen && !open ? <p className="rank-state">Opens at stage {grade.opensAtStage}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

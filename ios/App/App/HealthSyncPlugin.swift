import Foundation
import Capacitor
import HealthKit

/// Reads the four quantities Cut Tracker cares about from Apple Health and
/// returns per-day rows shaped exactly like the app's clipboard-import JSON:
/// [{date: "yyyy-MM-dd", weight, kcal, protein, steps}] — so the JS side can
/// reuse the existing parse/merge path unchanged.
@objc(HealthSyncPlugin)
public class HealthSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthSyncPlugin"
    public let jsName = "HealthSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readDaily", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    @objc func readDaily(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device")
            return
        }
        let days = call.getInt("days") ?? 14
        let readTypes: Set<HKObjectType> = [
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .bodyMass)!,
            HKObjectType.quantityType(forIdentifier: .dietaryEnergyConsumed)!,
            HKObjectType.quantityType(forIdentifier: .dietaryProtein)!,
        ]
        store.requestAuthorization(toShare: nil, read: readTypes) { _, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            self.query(days: days, call: call)
        }
    }

    private func query(days: Int, call: CAPPluginCall) {
        let cal = Calendar.current
        let endDay = cal.startOfDay(for: Date()).addingTimeInterval(86400)
        let startDay = cal.startOfDay(for: cal.date(byAdding: .day, value: -(days - 1), to: Date())!)

        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone.current

        let group = DispatchGroup()
        var kcal: [String: Double] = [:]
        var protein: [String: Double] = [:]
        var steps: [String: Double] = [:]
        var weight: [String: Double] = [:]
        let lock = NSLock()

        func dailySum(_ id: HKQuantityTypeIdentifier, unit: HKUnit, into write: @escaping (String, Double) -> Void) {
            group.enter()
            let type = HKQuantityType.quantityType(forIdentifier: id)!
            let pred = HKQuery.predicateForSamples(withStart: startDay, end: endDay, options: .strictStartDate)
            let q = HKStatisticsCollectionQuery(
                quantityType: type, quantitySamplePredicate: pred, options: .cumulativeSum,
                anchorDate: startDay, intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, results, _ in
                results?.enumerateStatistics(from: startDay, to: endDay) { stat, _ in
                    if let sum = stat.sumQuantity() {
                        lock.lock()
                        write(fmt.string(from: stat.startDate), sum.doubleValue(for: unit))
                        lock.unlock()
                    }
                }
                group.leave()
            }
            self.store.execute(q)
        }

        dailySum(.dietaryEnergyConsumed, unit: .kilocalorie()) { d, v in kcal[d] = v }
        dailySum(.dietaryProtein, unit: .gram()) { d, v in protein[d] = v }
        dailySum(.stepCount, unit: .count()) { d, v in steps[d] = v }

        // Body weight: keep each day's latest sample, in kg.
        group.enter()
        let wType = HKQuantityType.quantityType(forIdentifier: .bodyMass)!
        let wPred = HKQuery.predicateForSamples(withStart: startDay, end: endDay, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let wq = HKSampleQuery(sampleType: wType, predicate: wPred, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, _ in
            lock.lock()
            for s in (samples as? [HKQuantitySample]) ?? [] {
                weight[fmt.string(from: s.startDate)] = s.quantity.doubleValue(for: .gramUnit(with: .kilo))
            }
            lock.unlock()
            group.leave()
        }
        store.execute(wq)

        group.notify(queue: .main) {
            var dates = Set(kcal.keys)
            dates.formUnion(protein.keys)
            dates.formUnion(steps.keys)
            dates.formUnion(weight.keys)
            let rows: [[String: Any]] = dates.sorted().map { d in
                var row: [String: Any] = ["date": d]
                if let v = weight[d] { row["weight"] = (v * 100).rounded() / 100 }
                if let v = kcal[d] { row["kcal"] = v.rounded() }
                if let v = protein[d] { row["protein"] = v.rounded() }
                if let v = steps[d] { row["steps"] = v.rounded() }
                return row
            }
            call.resolve(["days": rows])
        }
    }
}

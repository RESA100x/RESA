package com.resa.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * Arms one exact alarm per calendar reminder.
 *
 * The Rust poller only runs while the app process lives; Android is free to
 * kill a backgrounded app, so a reminder set for tomorrow morning would never
 * ring. AlarmManager keeps the wake-up outside the process, and
 * [ReminderReceiver] posts the notification.
 *
 * Called from Rust through JNI (`com.resa.app.ReminderAlarms.schedule`).
 */
object ReminderAlarms {
  const val CHANNEL_ID = "resa-calendar-reminders"

  private const val ACTION = "com.resa.app.REMINDER"
  private const val EXTRA_ID = "resa.reminder.id"
  private const val EXTRA_TITLE = "resa.reminder.title"
  private const val EXTRA_BODY = "resa.reminder.body"

  @JvmStatic
  fun schedule(context: Context, id: String, title: String, body: String, fireAtMillis: Long) {
    ensureChannel(context)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = pendingIntent(context, id, title, body)
    // Android 12+ can withhold the exact-alarm privilege. A plain alarm still
    // fires, just not to the second, which beats not ringing at all.
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
    try {
      if (exact) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAtMillis, pending)
      } else {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAtMillis, pending)
      }
    } catch (_: SecurityException) {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAtMillis, pending)
    }
  }

  @JvmStatic
  fun cancel(context: Context, id: String) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(pendingIntent(context, id, "", ""))
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "یادآوری تقویم",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "یادآوری رویدادهای تقویم RESA"
      enableVibration(true)
    }
    manager.createNotificationChannel(channel)
  }

  fun idOf(intent: Intent): String = intent.getStringExtra(EXTRA_ID) ?: "resa.reminder"
  fun titleOf(intent: Intent): String = intent.getStringExtra(EXTRA_TITLE) ?: "RESA"
  fun bodyOf(intent: Intent): String = intent.getStringExtra(EXTRA_BODY) ?: ""

  private fun pendingIntent(
    context: Context,
    id: String,
    title: String,
    body: String
  ): PendingIntent {
    val intent = Intent(context, ReminderReceiver::class.java).apply {
      action = ACTION
      // A stable data URI keeps each reminder's PendingIntent distinct, so
      // arming a second reminder never replaces the first.
      data = Uri.parse("resa://reminder/$id")
      putExtra(EXTRA_ID, id)
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_BODY, body)
    }
    return PendingIntent.getBroadcast(
      context,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}

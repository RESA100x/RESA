package com.resa.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Posts the notification an AlarmManager alarm woke us up for.
 *
 * Runs even when the app process was killed: the OS starts the app just long
 * enough to deliver the broadcast, which is exactly what a reminder needs.
 */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ReminderAlarms.ensureChannel(context)
    val id = ReminderAlarms.idOf(intent)
    val title = ReminderAlarms.titleOf(intent)
    val body = ReminderAlarms.bodyOf(intent)

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = launch?.let {
      PendingIntent.getActivity(
        context,
        id.hashCode(),
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val notification = NotificationCompat.Builder(context, ReminderAlarms.CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_reminder)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setContentIntent(contentIntent)
      .build()

    try {
      NotificationManagerCompat.from(context).notify(id.hashCode(), notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS was refused; nothing else to do here.
    }
  }
}
